import { bytesToHex } from "@noble/ciphers/utils"
import { getRandomBytes } from "./crypto"
import { decrypt, encrypt, getSharedSecret, KeyPair } from "./encryption"
import { sendEncryptedJsonRpcRequest } from "./json-rpc"
import { getWebSocketClient, WebSocketClient } from "./websocket"
import debug from "debug"
import * as pako from "pako"

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10

/**
 * Bridge event types
 */
export enum BridgeEventType {
  Connected = "connected",
  SecureChannelEstablished = "secure-channel-established",
  MessageReceived = "message-received",
  ChunkRecieved = "chunk-received",
  Error = "error",
  Disconnected = "disconnected",
}

/**
 * Bridge event callback types
 */
export type BridgeEventCallback = {
  [BridgeEventType.Connected]: (reconnection: boolean) => void
  [BridgeEventType.SecureChannelEstablished]: () => void
  [BridgeEventType.MessageReceived]: (message: any) => void
  [BridgeEventType.ChunkRecieved]: (message: any) => void
  [BridgeEventType.Error]: (error: string) => void
  [BridgeEventType.Disconnected]: () => void
}

/**
 * Interface for bridge connection options
 */
export interface BridgeOptions {
  role: "creator" | "joiner"
  keyPair: KeyPair
  bridgeId?: string
  reconnect?: boolean
  reconnectAttempts?: number
  keepalive?: boolean
  origin?: string
  domain?: string
  pingInterval?: number
  bridgeUrl?: string
}

/**
 * BridgeConnection implementation
 *
 * A single class that handles both creator and joiner roles and manages its own state
 */
export class BridgeConnection {
  private log: debug.Debugger
  private role: "creator" | "joiner"
  private origin?: string
  private _bridgeOrigin?: string
  private bridgeId: string
  public readonly keyPair: KeyPair
  private remotePublicKey?: Uint8Array
  private sharedSecret?: Uint8Array
  private websocket?: WebSocketClient
  private secureChannelEstablished = false
  private intentionalClose = false
  public readonly keepalive: boolean
  private reconnect: boolean
  private reconnectAttempts = 0
  private maxReconnectAttempts: number
  private reconnectTimer?: Timer
  private pingTimer?: Timer
  private pingInterval = 30000
  private isReconnecting = false
  private isConnected = false
  private resumedSession = false
  private bridgeUrl?: string
  private validMessagesReceived = 0

  // Event handlers
  private eventListeners: {
    [BridgeEventType.Connected]: Array<(reconnection: boolean) => void>
    [BridgeEventType.SecureChannelEstablished]: Array<() => void>
    [BridgeEventType.MessageReceived]: Array<(message: any) => void>
    [BridgeEventType.ChunkRecieved]: Array<(message: any) => void>
    [BridgeEventType.Error]: Array<(error: string) => void>
    [BridgeEventType.Disconnected]: Array<() => void>
  }

  // Map to store incomplete messages
  private incompleteMessages: Map<string, { chunks: string[]; expectedChunks: number; timestamp: number }> = new Map()

  // Set to track seen JSON RPC message IDs (both sent and received)
  private seenMessageIds: Set<string> = new Set()

  /**
   * Create a new bridge connection
   * @param options Connection options
   */
  constructor(options: BridgeOptions) {
    this.role = options.role
    this.origin = options.origin
    this._bridgeOrigin = options.domain
    this.log = debug(`bridge:${this.role}`)
    this.bridgeId = options.bridgeId || Buffer.from(getRandomBytes(16)).toString("hex")
    this.keyPair = options.keyPair
    this.reconnect = options.reconnect ?? true
    this.keepalive = options.keepalive ?? true
    this.maxReconnectAttempts = options.reconnectAttempts || DEFAULT_MAX_RECONNECT_ATTEMPTS
    this.pingInterval = options.pingInterval || 30000
    this.bridgeUrl = options.bridgeUrl ?? "wss://bridge.zkpassport.id"

    // Initialize event listeners
    this.eventListeners = {
      [BridgeEventType.Connected]: [],
      [BridgeEventType.SecureChannelEstablished]: [],
      [BridgeEventType.MessageReceived]: [],
      [BridgeEventType.ChunkRecieved]: [],
      [BridgeEventType.Error]: [],
      [BridgeEventType.Disconnected]: [],
    }
  }

  public resume(): void {
    this.log("Resuming bridge session")
    this.secureChannelEstablished = true
    this.resumedSession = true
  }

  /**
   * Add an event listener
   * @param event The event type
   * @param callback The callback function
   * @returns Function to remove the event listener
   */
  public on<T extends BridgeEventType>(event: T, callback: BridgeEventCallback[T]): () => void {
    this.eventListeners[event].push(callback as any)
    return () => this.off(event, callback)
  }

  /**
   * Remove an event listener
   * @param event The event type
   * @param callback The callback function
   */
  public off<T extends BridgeEventType>(event: T, callback: BridgeEventCallback[T]): void {
    const index = this.eventListeners[event].indexOf(callback as any)
    if (index !== -1) {
      this.eventListeners[event].splice(index, 1)
    }
  }

  /**
   * Emit an event
   * @param event The event type
   * @param args The event arguments
   */
  private async emit<T extends BridgeEventType>(event: T, ...args: Parameters<BridgeEventCallback[T]>): Promise<void> {
    await Promise.all(
      this.eventListeners[event].map(async (listener) => {
        try {
          await (listener as (...args: any[]) => Promise<void> | void)(...args)
        } catch (error) {
          this.log(`Error in ${event} listener:`, error)
        }
      })
    )
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupWebSocketHandlers(websocket: WebSocketClient): void {
    websocket.onopen = async () => {
      this.isConnected = true

      // Set up ping timer
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = setInterval(() => {
        if (this.websocket) this.websocket.send(JSON.stringify({ method: "ping", params: {} }))
      }, this.pingInterval)

      // Emit the connected event
      if (this.isReconnecting) {
        this.log("Reconnected to bridge")
        this.resetReconnection()
        await this.emit(BridgeEventType.Connected, true)
      } else {
        this.log("Connected to bridge")
        await this.emit(BridgeEventType.Connected, false)
        // Fire the initial secure channel established event if this session was resumed
        if (this.resumedSession) {
          this.log("Resumed session, emitting secure channel established event")
          await this.emit(BridgeEventType.SecureChannelEstablished)
        }
      }
    }

    websocket.onmessage = async (event: any) => {
      // this.log("Received message:", event.data)
      try {
        const data = JSON.parse(event.data)
        await this.handleWebSocketMessage(data)
      } catch (error) {
        this.log("Error parsing message:", error)
        await this.emit(BridgeEventType.Error, `Error parsing message: ${error}`)
      }
    }

    websocket.onerror = async (error: any) => {
      this.log("WebSocket Error:", error)
      await this.emit(BridgeEventType.Error, `WebSocket error: ${error}`)

      if (this.reconnect && !this.isConnected) {
        await this.handleReconnect()
      }
    }

    websocket.onclose = async () => {
      if (this.pingTimer) clearInterval(this.pingTimer)
      if (!this.isConnected) return
      this.isConnected = false

      this.log("WebSocket closed")

      // Emit the disconnected event so listeners can respond
      await this.emit(BridgeEventType.Disconnected)

      if (this.intentionalClose) {
        this.log("Intentional close, not attempting to reconnect")
        return
      }

      if (this.reconnect) {
        await this.handleReconnect()
      }
    }
  }

  /**
   * Handle WebSocket messages based on message type
   */
  private async handleWebSocketMessage(data: any): Promise<void> {
    // Respond to ping messages
    if (data.method === "ping") {
      this.log("Received ping message, responding with pong")
      this.websocket?.send(JSON.stringify({ method: "pong", params: {} }))
      return
    }
    // Ignore pong messages
    if (data.method === "pong") return

    // Check for missing message id
    if (!data.id) {
      this.log(`Ignoring message with missing id`)
      console.log(data)
      return
    }
    // Check for duplicate message id
    if (this.seenMessageIds.has(data.id)) {
      this.log(`Ignoring message with duplicate id: ${data.id}`)
      return
    }
    // Track this message ID
    this.seenMessageIds.add(data.id)
    this.validMessagesReceived += 1

    // Handle handshake message (for creator role)
    if (this.role === "creator" && data.method === "handshake") {
      // TODO: This may be the ideal behaviour rather than responding with an error
      // if (this.secureChannelEstablished) {
      //   this.log("Secure channel already established, ignoring handshake message")
      //   return
      // }
      this.log("Processing handshake message")
      await this.handleHandshake(data)
    }

    // Handle encrypted messages
    if (data.method === "encryptedMessage") {
      this.log("Processing encrypted message")

      // For joiner role, verify origin from creator message matches expected origin
      if (this.role === "joiner" && this._bridgeOrigin) {
        const parsedOrigin = data.origin ? parseOriginHeader(data.origin) : undefined
        if (parsedOrigin !== this._bridgeOrigin) {
          this.log(
            `WARNING: Origin differs from origin in connection string. Expected ${this._bridgeOrigin} but got ${parsedOrigin}`
          )
          this.log("Ignoring received message:", data)
          this.emit(
            BridgeEventType.Error,
            `Origin ${parsedOrigin} does not match expected origin ${this._bridgeOrigin}`
          )
          return
        }
      }

      await this.handleEncryptedMessage(data)
    }
  }

  /**
   * Handle handshake message (for creator)
   */
  private async handleHandshake(data: any): Promise<void> {
    this.log("Received handshake:", data)
    try {
      // Get joiner public key
      const joinerPublicKey = new Uint8Array(Buffer.from(data.params.pubkey, "hex"))
      // If secure channel is already established, the remote public key cannot be changed
      if (this.secureChannelEstablished) {
        if (this.remotePublicKey !== joinerPublicKey) {
          this.log("Secure channel already established, ignoring handshake")
          this.emit(BridgeEventType.Error, "Secure channel already established, ignoring handshake")
          // TODO: Improve handshake error handling and how it responds / rejects the handshake
          this.websocket?.send(
            JSON.stringify({
              method: "error",
              params: { message: "Secure channel already established, ignoring handshake" },
            })
          )
          return
        }
      }

      // Set remote public key
      this.remotePublicKey = joinerPublicKey

      // Compute shared secret
      this.sharedSecret = await getSharedSecret(this.keyPair.privateKey, joinerPublicKey)

      // Decrypt greeting
      const greeting = await decrypt(Buffer.from(data.params.greeting, "hex"), this.sharedSecret, this.bridgeId)
      if (greeting !== "hello") throw new Error("Invalid greeting")

      // Send hello message back to joiner to finalize handshake
      if (this.websocket) {
        const result = await sendEncryptedJsonRpcRequest(
          "hello",
          null,
          this.sharedSecret,
          this.bridgeId,
          this.websocket
        )
        // Track the message IDs we sent
        result.messageIds.forEach((id) => this.seenMessageIds.add(id))
      }

      // Only emit secure channel established event if it hasn't been emitted yet
      if (this.secureChannelEstablished) {
        this.log("Secure channel already established, sending handshake message again")
      } else {
        // Mark secure channel as established
        this.secureChannelEstablished = true
        await this.emit(BridgeEventType.SecureChannelEstablished)
      }
    } catch (error) {
      this.log("Error handling handshake:", error)
      await this.emit(BridgeEventType.Error, `Error handling handshake: ${error}`)
    }
  }

  /**
   * Handle encrypted message
   */
  private async handleEncryptedMessage(data: any): Promise<void> {
    try {
      // decrypt the message
      if (!this.sharedSecret) throw new Error("Shared secret not available")
      const payload = new Uint8Array(Buffer.from(data.params.payload, "base64"))
      const decrypted = await decrypt(payload, this.sharedSecret, this.bridgeId)
      const decryptedJson = JSON.parse(decrypted)
      if (!decryptedJson.chunk || decryptedJson.chunk.length == 1) {
        if (decryptedJson.method === "hello" && !this.secureChannelEstablished) {
          // handle handshake message
          this.log(`Verified origin: ${data.origin}`)
          this.secureChannelEstablished = true
          // Notify listeners about the received message
          await this.emit(BridgeEventType.SecureChannelEstablished)
        } else {
          // if has payload, attempt to decompress it it
          try {
            if (decryptedJson.params && decryptedJson.params.length > 0) {
              this.log(`Received compressed single-part message`)
              const compressedData = Buffer.from(decryptedJson.params, "base64")
              const decompressedData = pako.inflate(compressedData)
              const decompressedText = new TextDecoder().decode(decompressedData)
              decryptedJson.params = JSON.parse(decompressedText)
              delete decryptedJson.chunk
            }
          } catch (error) {
            // ensure error was due to compression
            // this is included to ensure legacy messages are not rejected
            if (error !== "incorrect header check") {
              console.error("Some error happened data:", error)
              throw new Error("Failed to parse data: ")
            }
            this.log(`Received uncompressed single-part message`)
            // check if the data needs to be json parsed
            try {
              decryptedJson.params = JSON.parse(decryptedJson.params)
            } catch {
              // Ignore error
            }
          }
          // Notify listeners about the received message
          await this.emit(BridgeEventType.MessageReceived, decryptedJson)
        }
      } else {
        // handle chunked messages
        const { index, length, id } = decryptedJson.chunk
        this.log(`Received chunk (${index + 1}/${length}) for chunk id ${id}`)

        // Initialize incomplete message storage if this is the first chunk we receive for this id
        if (!this.incompleteMessages.has(id)) {
          this.incompleteMessages.set(id, {
            chunks: new Array(length), // Pre-allocate array with correct length
            expectedChunks: length,
            timestamp: Date.now(),
          })
        }

        const message = this.incompleteMessages.get(id)!

        // Verify the expected chunks count matches
        if (message.expectedChunks !== length) {
          this.log(`Chunk count mismatch for id ${id}. Expected ${message.expectedChunks}, got ${length}`)
          throw new Error(`Chunk count mismatch for id ${id}. Expected ${message.expectedChunks}, got ${length}`)
        }

        // Store the chunk at the correct index
        message.chunks[index] = decryptedJson.params
        await this.emit(BridgeEventType.ChunkRecieved, decryptedJson.chunk)

        // Check if we have received all chunks (no undefined values in the array)
        const allChunksReceived = (() => {
          for (let i = 0; i < message.chunks.length; i++) {
            if (message.chunks[i] === undefined) {
              return false
            }
          }
          return true
        })()

        if (allChunksReceived) {
          // recompose the chunks into the message
          const fullMessage = message.chunks.join("")
          const compressedMessage = Buffer.from(fullMessage, "base64")
          const decompressedData = pako.inflate(compressedMessage)
          const decompressedText = new TextDecoder().decode(decompressedData)
          const decryptedPayload = JSON.parse(decompressedText)
          this.log(`Received all chunks for chunk id ${id}, reconstructing message`)
          const returnValue = { method: decryptedJson.method, params: decryptedPayload }
          // delete the message from the map
          this.incompleteMessages.delete(id)
          // Notify listeners about the received message
          await this.emit(BridgeEventType.MessageReceived, returnValue)
        }
      }
    } catch (error) {
      this.log("Error decrypting message:", error)
      await this.emit(BridgeEventType.Error, `Error decrypting message: ${error}`)
    }
  }

  /**
   * Handle reconnection logic
   */
  private async handleReconnect(): Promise<void> {
    this.reconnectAttempts++
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.log(`WebSocket disconnected, max reconnection attempts (${this.maxReconnectAttempts}) reached`)
      this.resetReconnection()
      return
    }

    this.isReconnecting = true
    this.log(`WebSocket disconnected, attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`)

    let reconnectIn = 0
    // First attempt is immediate, subsequent attempts follow doubling delay pattern
    if (this.reconnectAttempts > 1) {
      // Delay pattern: 1s, 2s, 4s, 8s, etc.
      reconnectIn = 1000 * Math.pow(2, this.reconnectAttempts - 2)
      this.log(`Waiting ${reconnectIn}ms before reconnecting...`)
    }

    this.reconnectTimer = setTimeout(async () => {
      try {
        const reconnectionUrl = await this._getWsConnectionUrl()
        // Create new WebSocket connection
        this.websocket = await (this.origin
          ? getWebSocketClient(reconnectionUrl, this.origin)
          : getWebSocketClient(reconnectionUrl))
        this.setupWebSocketHandlers(this.websocket)
      } catch (error) {
        this.log("Reconnection failed:", error)
        await this.handleReconnect()
      }
    }, reconnectIn)
  }
  /**
   * Reset reconnection state
   */
  private resetReconnection(): void {
    this.log("Resetting reconnection state")
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.reconnectAttempts = 0
    this.isReconnecting = false
  }

  /**
   * Check if the bridge is connected
   */
  public isBridgeConnected(): boolean {
    if (!this.websocket) {
      return false
    }
    return this.websocket.readyState === WebSocket.OPEN
  }

  /**
   * Check if the secure channel is established
   */
  public isSecureChannelEstablished(): boolean {
    return this.secureChannelEstablished
  }

  /**
   * Send a secure message
   * @param method The message method name
   * @param params The message parameters
   */
  public async sendSecureMessage(method: string, params: any = {}): Promise<boolean> {
    if (!this.isConnected || !this.secureChannelEstablished) {
      await this.emit(BridgeEventType.Error, "Cannot send message: Secure channel not established")
      return false
    }
    const result = await sendEncryptedJsonRpcRequest(
      method,
      params,
      this.sharedSecret!,
      // TODO: Make the nonce the JSON id of the outer message
      this.bridgeId,
      this.websocket!
    )
    // Track the message IDs we sent
    result.messageIds.forEach((id) => this.seenMessageIds.add(id))
    return result.success
  }

  /**
   * Register a callback for when the bridge connects
   * @returns Function to unsubscribe from the event
   */
  public onConnect(callback: (reconnection: boolean) => void): () => void {
    return this.on(BridgeEventType.Connected, callback)
  }

  /**
   * Register a callback for when the secure channel is established
   * @returns Function to unsubscribe from the event
   */
  public onSecureChannelEstablished(callback: () => void): () => void {
    return this.on(BridgeEventType.SecureChannelEstablished, callback)
  }

  /**
   * Register a callback for when a message is received
   * @returns Function to unsubscribe from the event
   */
  public onSecureMessage(callback: (message: any) => void): () => void {
    return this.on(BridgeEventType.MessageReceived, callback)
  }

  /**
   * Register a callback for when an error occurs
   * @returns Function to unsubscribe from the event
   */
  public onError(callback: (error: string) => void): () => void {
    return this.on(BridgeEventType.Error, callback)
  }

  /**
   * Register a callback for when the bridge disconnects
   * @returns Function to unsubscribe from the event
   */
  public onDisconnect(callback: () => void): () => void {
    return this.on(BridgeEventType.Disconnected, callback)
  }

  /**
   * Set the remote public key
   */
  public setRemotePublicKey(publicKey: Uint8Array): void {
    this.remotePublicKey = publicKey
  }

  /**
   * Compute the shared secret
   */
  public async computeSharedSecret(): Promise<void> {
    if (!this.remotePublicKey) {
      throw new Error("Remote public key not set")
    }
    this.sharedSecret = await getSharedSecret(this.keyPair.privateKey, this.remotePublicKey)
  }

  /**
   * Create an encrypted greeting
   */
  public async createEncryptedGreeting(): Promise<string> {
    if (!this.sharedSecret) {
      throw new Error("Shared secret not available")
    }
    const greeting = await encrypt("hello", this.sharedSecret, this.bridgeId)
    return Buffer.from(greeting).toString("hex")
  }

  /**
   * Get the WebSocket connection URL for a joiner
   * NOTE: If the pubkey param is provided in the WS connection URI,
   *       the bridge server will automatically send a handshake on connect
   * @returns The WebSocket connection URL
   */
  public async _getWsConnectionUrl(): Promise<string> {
    if (this.role === "creator") {
      return `${this.bridgeUrl}?topic=${this.getBridgeId()}`
    } else {
      if (!this.isSecureChannelEstablished()) {
        const greeting = await this.createEncryptedGreeting()
        return `${this.bridgeUrl}?topic=${this.getBridgeId()}&pubkey=${this.getPublicKey()}&greeting=${greeting}`
      } else {
        return `${this.bridgeUrl}?topic=${this.getBridgeId()}`
      }
    }
  }

  /**
   * Get the public key as a hex string
   */
  public getPublicKey(): string {
    return bytesToHex(this.keyPair.publicKey)
  }

  /**
   * Get the remote public key as a hex string
   */
  public getRemotePublicKey(): string {
    if (!this.remotePublicKey) {
      throw new Error("Remote public key not set")
    }
    return bytesToHex(this.remotePublicKey)
  }

  /**
   * Get the bridge ID
   */
  public getBridgeId(): string {
    return this.bridgeId
  }

  /**
   * Get the WebSocket client
   */
  public getWebSocket(): WebSocketClient | undefined {
    return this.websocket
  }

  /**
   * Get the bridge origin (the origin of the creator)
   */
  public get bridgeOrigin(): string {
    if (this.role === "creator") return this.origin!
    else return this._bridgeOrigin!
  }

  /**
   * Get a connection string URI for joining the bridge
   */
  public get connectionString(): string {
    if (this.role === "creator") {
      return `obsidion:${this.getPublicKey()}?d=${this.bridgeOrigin!}`
    } else {
      return `obsidion:${this.getBridgeId()}?d=${this.bridgeOrigin!}`
    }
  }

  /**
   * Connect to the bridge service
   */
  public async connect(url: string): Promise<void> {
    try {
      this.log("Connecting to bridge", url)
      // Create WebSocket connection to the bridge
      const websocket = await (this.origin ? getWebSocketClient(url, this.origin) : getWebSocketClient(url))
      this.websocket = websocket
      this.setupWebSocketHandlers(websocket)
    } catch (error) {
      this.log("Error connecting to bridge:", error)
      await this.emit(BridgeEventType.Error, `Error connecting to bridge: ${error}`)
      throw error
    }
  }

  /**
   * Close the bridge and clear all event listeners
   */
  public close(): void {
    this.log("Closing the bridge")
    this.intentionalClose = true

    // Close the websocket
    if (this.websocket) {
      this.websocket.close(1000, "Connection closed by user")
      // Remove all event handlers from the websocket
      this.websocket.onopen = null
      this.websocket.onmessage = null
      this.websocket.onerror = null
      this.websocket.onclose = null
    }
    this.emit(BridgeEventType.Disconnected)

    this.websocket = undefined
    this.secureChannelEstablished = false
    this.sharedSecret = undefined
    this.remotePublicKey = undefined

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = undefined

    // Clear all event listeners
    this.eventListeners = {
      [BridgeEventType.Connected]: [],
      [BridgeEventType.SecureChannelEstablished]: [],
      [BridgeEventType.MessageReceived]: [],
      [BridgeEventType.ChunkRecieved]: [],
      [BridgeEventType.Error]: [],
      [BridgeEventType.Disconnected]: [],
    }
  }
}

// Return just the scheme and host (excluding port)
function parseOriginHeader(origin: string): string | undefined {
  try {
    const parsed = new URL(origin)
    return `${parsed.protocol}//${parsed.host.split(":")[0]}`
  } catch {
    return origin
  }
}
