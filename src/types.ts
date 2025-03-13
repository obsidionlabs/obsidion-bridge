import { WebSocketClient } from "./websocket"

/**
 * Common types for key pairs and cryptographic data
 */
export interface KeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

/**
 * Connection state for a topic
 */
export interface TopicState {
  keyPair: KeyPair
  webSocketClient?: WebSocketClient
  secureChannelEstablished: boolean
  sharedSecret?: Uint8Array
  remotePublicKey?: Uint8Array
}

/**
 * Interface for bridge connection results
 */
export interface BridgeConnectionResult {
  websocket: WebSocketClient

  /**
   * The URL of the request.
   *
   * You can either encode the URL in a QR code or let the user click the link
   * to this URL on your website if they're visiting your website on their phone.
   */
  url?: string

  /**
   * The WebSocket bridge topic / subscription id
   */
  topic: string

  /**
   * Called when the SDK successfully connects to the bridge.
   */
  onBridgeConnect: (callback: (topic: string) => void) => void

  /**
   * Called when a secure channel has been established.
   * This means the ECDH key exchange has completed and messages can be encrypted.
   */
  onSecureChannelEstablished: (callback: () => void) => void

  /**
   * Called when an encrypted message is received.
   */
  onMessageReceived: (callback: (message: any) => void) => void

  /**
   * Called when an error occurs during the connection or message exchange.
   */
  onError: (callback: (error: string) => void) => void

  /**
   * @returns true if the bridge is connected
   */
  isBridgeConnected: () => boolean

  /**
   * @returns true if a secure channel has been established
   */
  isSecureChannelEstablished: () => boolean

  /**
   * Send an encrypted message.
   * @param method The method name for the message
   * @param params The parameters for the message
   * @returns A promise that resolves to true if the message was sent successfully
   */
  sendSecureMessage: (method: string, params?: any) => Promise<boolean>

  /**
   * Close the connection to the bridge.
   */
  close: () => void
}
