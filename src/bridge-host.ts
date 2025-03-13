import { randomBytes } from "crypto"
import { bytesToHex } from "@noble/ciphers/utils"
import { getWebSocketClient, WebSocketClient } from "./websocket"
import { sendEncryptedJsonRpcRequest } from "./json-rpc"
import { decrypt, generateECDHKeyPair } from "./encryption"
import { EventType, EventManager } from "./events"
import { TopicManager } from "./topic-manager"
import { BridgeConnectionResult, KeyPair } from "./types"
import debug from "debug"

const log = debug("bridge:host")

/**
 * Options for connecting to a bridge
 */
export interface ConnectOptions {
  topic?: string
  keyPair?: KeyPair
}

/**
 * Bridge host implementation
 */
export class BridgeHost {
  private origin: string
  private topicManager = new TopicManager()
  private eventManager = new EventManager()

  /**
   * Create a new bridge host instance.
   * @param origin The origin of your website.
   */
  constructor(origin?: string) {
    if (!origin && typeof window === "undefined") {
      throw new Error("Origin argument is required in Node.js environment")
    }
    this.origin = origin || window.location.protocol + "//" + window.location.hostname
  }

  /**
   * Handle an incoming encrypted message.
   */
  private async handleEncryptedMessage(topic: string, request: any) {
    log("Received encrypted message:", request)

    // Notify listeners about the received message
    await this.eventManager.emitMessageReceived(topic, request)
  }

  /**
   * Create a new bridge connection.
   * @param options Connection options
   * @returns A promise that resolves to a BridgeConnectionResult.
   */
  public async connect(options: ConnectOptions = {}): Promise<BridgeConnectionResult> {
    // Generate or use provided topic
    const topic = options.topic || randomBytes(16).toString("hex")

    // Generate or use provided key pair
    const keyPair = options.keyPair || (await generateECDHKeyPair())

    // Initialize topic state
    this.topicManager.initializeTopic(topic, keyPair)

    // Create the URL for a subscriber (like a mobile app) to connect
    const url = this.createConnectUrl(topic, keyPair.publicKey)

    // Set up WebSocket connection
    const websocket = getWebSocketClient(`wss://bridge.zkpassport.id?topic=${topic}`, this.origin)

    // Store WebSocket client
    this.topicManager.setWebSocketClient(topic, websocket)

    // Set up WebSocket event handlers
    this.setupWebSocketHandlers(websocket, topic)

    // Return connection result
    return this.createConnectionResult(topic, url, websocket)
  }

  /**
   * Create the URL for a subscriber to connect
   */
  private createConnectUrl(topic: string, publicKey: Uint8Array): string {
    return `https://zkpassport.id/r?d=${encodeURIComponent(
      new URL(this.origin).hostname,
    )}&t=${topic}&p=${bytesToHex(publicKey)}`
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupWebSocketHandlers(websocket: WebSocketClient, topic: string): void {
    websocket.onopen = async () => {
      log("Connected to bridge")
      await this.eventManager.emitBridgeConnected(topic)
    }

    websocket.onmessage = async (event: any) => {
      log("Received message:", event.data)
      try {
        const data = JSON.parse(event.data)

        // Handle handshake message
        if (data.method === "handshake") {
          await this.handleHandshake(topic, data, websocket)
        }

        // Handle encrypted messages
        if (data.method === "encryptedMessage") {
          await this.handleEncryptedMessageData(topic, data)
        }
      } catch (error) {
        log("Error parsing message:", error)
        await this.eventManager.emitError(topic, `Error parsing message: ${error}`)
      }
    }

    websocket.onerror = async (error: any) => {
      log("WebSocket Error:", error)
      await this.eventManager.emitError(topic, `WebSocket error: ${error}`)
    }

    websocket.onclose = async () => {
      log("WebSocket closed")
    }
  }

  /**
   * Handle handshake message
   */
  private async handleHandshake(
    topic: string,
    data: any,
    websocket: WebSocketClient,
  ): Promise<void> {
    log("Received handshake:", data)

    try {
      // Get subscriber public key
      const subscriberPublicKey = new Uint8Array(Buffer.from(data.params.pubkey, "hex"))

      // Set remote public key
      this.topicManager.setRemotePublicKey(topic, subscriberPublicKey)

      // Compute shared secret
      const sharedSecret = await this.topicManager.computeSharedSecret(topic)

      // Decrypt greeting
      const greeting = await decrypt(Buffer.from(data.params.greeting, "hex"), sharedSecret, topic)
      log("Decrypted greeting:", greeting)
      if (greeting !== "hello") {
        throw new Error("Invalid greeting")
      }

      // Send hello message to verify domain
      await sendEncryptedJsonRpcRequest("hello", null, sharedSecret, topic, websocket)

      // Mark secure channel as established
      this.topicManager.setSecureChannelEstablished(topic, true)
      await this.eventManager.emitSecureChannelEstablished(topic)
    } catch (error) {
      log("Error handling handshake:", error)
      await this.eventManager.emitError(topic, `Error handling handshake: ${error}`)
    }
  }

  /**
   * Handle encrypted message data
   */
  private async handleEncryptedMessageData(topic: string, data: any): Promise<void> {
    try {
      const sharedSecret = this.topicManager.getSharedSecret(topic)
      if (!sharedSecret) {
        throw new Error("Shared secret not available")
      }

      const payload = new Uint8Array(Buffer.from(data.params.payload, "base64"))
      const decrypted = await decrypt(payload, sharedSecret, topic)
      const decryptedJson = JSON.parse(decrypted)
      this.handleEncryptedMessage(topic, decryptedJson, data)
    } catch (error) {
      log("Error decrypting message:", error)
      await this.eventManager.emitError(topic, `Error decrypting message: ${error}`)
    }
  }

  /**
   * Create a connection result object
   */
  private createConnectionResult(
    topic: string,
    url: string,
    websocket: WebSocketClient,
  ): BridgeConnectionResult {
    return {
      url,
      websocket,
      topic,
      onBridgeConnect: (callback: (topic: string) => void) =>
        this.eventManager.addEventListener(topic, EventType.BridgeConnected, callback),
      onSecureChannelEstablished: (callback: () => void) =>
        this.eventManager.addEventListener(topic, EventType.SecureChannelEstablished, callback),
      onMessageReceived: (callback: (message: any) => void) =>
        this.eventManager.addEventListener(topic, EventType.MessageReceived, callback),
      onError: (callback: (error: string) => void) =>
        this.eventManager.addEventListener(topic, EventType.Error, callback),
      isBridgeConnected: () => this.topicManager.isBridgeConnected(topic),
      isSecureChannelEstablished: () => this.topicManager.isSecureChannelEstablished(topic),
      sendSecureMessage: async (method: string, params?: any) => {
        if (!this.topicManager.isSecureChannelEstablished(topic)) {
          await this.eventManager.emitError(
            topic,
            "Cannot send message: Secure channel not established",
          )
          return false
        }

        const sharedSecret = this.topicManager.getSharedSecret(topic)
        const websocket = this.topicManager.getWebSocketClient(topic)

        if (!sharedSecret || !websocket) {
          await this.eventManager.emitError(
            topic,
            "Cannot send message: Connection not properly established",
          )
          return false
        }

        return sendEncryptedJsonRpcRequest(method, params || {}, sharedSecret, topic, websocket)
      },
      close: () => {
        const websocket = this.topicManager.getWebSocketClient(topic)
        if (websocket) {
          websocket.close()
          this.topicManager.removeTopic(topic)
          this.eventManager.removeEventListeners(topic)
        }
      },
    }
  }

  /**
   * Close all active connections.
   */
  public closeAll() {
    // Close all WebSocket connections
    for (const topic of this.topicManager.getTopics()) {
      const websocket = this.topicManager.getWebSocketClient(topic)
      if (websocket) {
        websocket.close()
      }
    }

    // Clear all data
    this.topicManager.clearAllTopics()
    this.eventManager.clearAllEventListeners()
  }
}
