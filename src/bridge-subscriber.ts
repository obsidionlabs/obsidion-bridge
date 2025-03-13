import { bytesToHex } from "@noble/ciphers/utils"
import { getWebSocketClient, WebSocketClient } from "./websocket"
import { sendEncryptedJsonRpcRequest, JsonRpcRequest } from "./json-rpc"
import { decrypt, encrypt, generateECDHKeyPair } from "./encryption"
import { EventType, EventManager } from "./events"
import { TopicManager } from "./topic-manager"
import { BridgeConnectionResult, KeyPair } from "./types"
import debug from "debug"

const log = debug("bridge:subscriber")

/**
 * Options for connecting to a bridge
 */
export interface ConnectOptions {
  keyPair?: KeyPair
}

/**
 * Subscriber bridge implementation
 */
export class BridgeSubscriber {
  private domain?: string
  private topicManager = new TopicManager()
  private eventManager = new EventManager()

  constructor() {}

  /**
   * Handle an incoming encrypted message.
   */
  private async handleEncryptedMessage(topic: string, request: any, outerRequest: any) {
    log("Decrypted message:", request)

    // Notify listeners about the received message
    await this.eventManager.emitMessageReceived(topic, request)

    if (request.method === "hello") {
      log(`Verified origin: ${outerRequest.origin}`)
      this.topicManager.setSecureChannelEstablished(topic, true)
      await this.eventManager.emitSecureChannelEstablished(topic)
    }
  }

  /**
   * Connect to a bridge using a URL from a QR code or link.
   * @param url The URL to connect to
   * @param options Connection options
   * @returns A promise that resolves to a BridgeConnectionResult
   */
  public async connect(url: string, options: ConnectOptions = {}): Promise<BridgeConnectionResult> {
    // Parse URL parameters
    const { domain, topic, pubkey } = this.parseConnectUrl(url)

    // Set domain
    this.domain = domain

    // Generate or use provided key pair
    const keyPair = options.keyPair || (await generateECDHKeyPair())

    // Initialize topic state
    this.topicManager.initializeTopic(topic, keyPair)

    // Set remote public key
    this.topicManager.setRemotePublicKey(topic, pubkey)

    // Compute shared secret
    const sharedSecret = await this.topicManager.computeSharedSecret(topic)

    // Encrypt greeting message
    const encryptedGreeting = await encrypt("hello", sharedSecret, topic)

    // Set up WebSocket connection
    const websocket = getWebSocketClient(
      `wss://bridge.zkpassport.id?topic=${topic}&pubkey=${bytesToHex(keyPair.publicKey)}&greeting=${Buffer.from(encryptedGreeting).toString("hex")}`,
    )

    // Store WebSocket client
    this.topicManager.setWebSocketClient(topic, websocket)

    // Set up WebSocket event handlers
    this.setupWebSocketHandlers(websocket, topic)

    // Return connection result
    return this.createConnectionResult(topic, websocket)
  }

  /**
   * Parse the connect URL and extract parameters
   */
  private parseConnectUrl(url: string): { domain: string; topic: string; pubkey: Uint8Array } {
    const parsedUrl = new URL(url)
    const domain = parsedUrl.searchParams.get("d")
    const topic = parsedUrl.searchParams.get("t")
    const pubkeyHex = parsedUrl.searchParams.get("p")

    if (!domain || !topic || !pubkeyHex) {
      throw new Error("Invalid URL: missing required parameters")
    }

    const pubkey = new Uint8Array(Buffer.from(pubkeyHex, "hex"))
    return { domain, topic, pubkey }
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupWebSocketHandlers(websocket: WebSocketClient, topic: string): void {
    websocket.onopen = async () => {
      log("Connected to bridge")
      await this.eventManager.emitBridgeConnected(topic)
      // NOTE: WebSocket bridge server broadcasts handshake automatically on connect when it sees a pubkey param in websocket URI
    }

    websocket.onmessage = async (event: any) => {
      log("Received message:", event.data)
      try {
        const data: JsonRpcRequest = JSON.parse(event.data)
        const originDomain = data.origin ? new URL(data.origin).hostname : undefined

        // Origin domain must match domain in QR code
        if (originDomain !== this.domain) {
          log(
            `WARNING: Origin does not match domain in QR code. Expected ${this.domain} but got ${originDomain}`,
          )
          log("Ignoring received message:", event.data)
          return
        }

        // Handle encrypted messages
        if (data.method === "encryptedMessage") {
          try {
            const sharedSecret = this.topicManager.getSharedSecret(topic)
            if (!sharedSecret) {
              throw new Error("Shared secret not available")
            }

            const payload = new Uint8Array(Buffer.from(data.params.payload, "base64"))
            const decrypted = await decrypt(payload, sharedSecret, topic)
            const decryptedJson = JSON.parse(decrypted)
            await this.handleEncryptedMessage(topic, decryptedJson, data)
          } catch (error) {
            log("Error decrypting message:", error)
            await this.eventManager.emitError(topic, `Error decrypting message: ${error}`)
          }
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
   * Create a connection result object
   */
  private createConnectionResult(
    topic: string,
    websocket: WebSocketClient,
  ): BridgeConnectionResult {
    return {
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
      sendSecureMessage: async (method: string, params: any) => {
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

        return sendEncryptedJsonRpcRequest(method, params, sharedSecret, topic, websocket)
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
