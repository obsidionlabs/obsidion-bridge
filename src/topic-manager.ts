import { WebSocketClient } from "./websocket"
import { KeyPair, TopicState } from "./types"
import { bytesToHex } from "@noble/ciphers/utils"
import { getSharedSecret } from "./encryption"

/**
 * Manages topic-related data and state
 */
export class TopicManager {
  private topicStates: Record<string, TopicState> = {}

  /**
   * Initialize a new topic with a key pair
   */
  public initializeTopic(topic: string, keyPair: KeyPair): void {
    this.topicStates[topic] = {
      keyPair,
      secureChannelEstablished: false,
    }
  }

  /**
   * Set the WebSocket client for a topic
   */
  public setWebSocketClient(topic: string, websocket: WebSocketClient): void {
    if (!this.topicStates[topic]) {
      throw new Error(`Topic ${topic} not initialized`)
    }
    this.topicStates[topic].webSocketClient = websocket
  }

  /**
   * Set the remote public key for a topic
   */
  public setRemotePublicKey(topic: string, remotePublicKey: Uint8Array): void {
    if (!this.topicStates[topic]) {
      throw new Error(`Topic ${topic} not initialized`)
    }
    this.topicStates[topic].remotePublicKey = remotePublicKey
  }

  /**
   * Compute and set the shared secret for a topic
   */
  public async computeSharedSecret(topic: string): Promise<Uint8Array> {
    const state = this.topicStates[topic]
    if (!state) {
      throw new Error(`Topic ${topic} not initialized`)
    }
    if (!state.remotePublicKey) {
      throw new Error(`Remote public key not set for topic ${topic}`)
    }

    const sharedSecret = await getSharedSecret(state.keyPair.privateKey, state.remotePublicKey)
    state.sharedSecret = sharedSecret
    return sharedSecret
  }

  /**
   * Set the secure channel established flag for a topic
   */
  public setSecureChannelEstablished(topic: string, established: boolean): void {
    if (!this.topicStates[topic]) {
      throw new Error(`Topic ${topic} not initialized`)
    }
    this.topicStates[topic].secureChannelEstablished = established
  }

  /**
   * Get the key pair for a topic
   */
  public getKeyPair(topic: string): KeyPair {
    const state = this.topicStates[topic]
    if (!state) {
      throw new Error(`Topic ${topic} not initialized`)
    }
    return state.keyPair
  }

  /**
   * Get the WebSocket client for a topic
   */
  public getWebSocketClient(topic: string): WebSocketClient | undefined {
    const state = this.topicStates[topic]
    if (!state) {
      throw new Error(`Topic ${topic} not initialized`)
    }
    return state.webSocketClient
  }

  /**
   * Get the shared secret for a topic
   */
  public getSharedSecret(topic: string): Uint8Array | undefined {
    const state = this.topicStates[topic]
    if (!state) {
      throw new Error(`Topic ${topic} not initialized`)
    }
    return state.sharedSecret
  }

  /**
   * Check if a secure channel is established for a topic
   */
  public isSecureChannelEstablished(topic: string): boolean {
    const state = this.topicStates[topic]
    if (!state) {
      throw new Error(`Topic ${topic} not initialized`)
    }
    return state.secureChannelEstablished
  }

  /**
   * Check if a bridge is connected for a topic
   */
  public isBridgeConnected(topic: string): boolean {
    const state = this.topicStates[topic]
    if (!state || !state.webSocketClient) {
      return false
    }
    return state.webSocketClient.readyState === WebSocket.OPEN
  }

  /**
   * Remove a topic and its associated data
   */
  public removeTopic(topic: string): void {
    delete this.topicStates[topic]
  }

  /**
   * Clear all topics and their associated data
   */
  public clearAllTopics(): void {
    this.topicStates = {}
  }

  /**
   * Get all topics
   */
  public getTopics(): string[] {
    return Object.keys(this.topicStates)
  }
}
