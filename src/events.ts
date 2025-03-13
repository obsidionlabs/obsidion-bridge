/**
 * Bridge event types
 */
export enum EventType {
  BridgeConnected,
  SecureChannelEstablished,
  MessageReceived,
  Error,
}

/**
 * Bridge event callback types
 */
export type EventCallbacks = {
  [EventType.BridgeConnected]: (topic: string) => void
  [EventType.SecureChannelEstablished]: () => void
  [EventType.MessageReceived]: (message: any) => void
  [EventType.Error]: (error: string) => void
}

/**
 * Types for the event listeners
 */
export type EventListenersMap = Record<
  string,
  {
    [EventType.BridgeConnected]: Array<(topic: string) => void>
    [EventType.SecureChannelEstablished]: Array<() => void>
    [EventType.MessageReceived]: Array<(message: any) => void>
    [EventType.Error]: Array<(error: string) => void>
  }
>

/**
 * Helper class for managing event listeners
 */
export class EventManager {
  private eventListeners: EventListenersMap = {}

  /**
   * Register an event listener for a specific topic and event type
   */
  public addEventListener(
    topic: string,
    eventType: EventType.BridgeConnected,
    callback: (topic: string) => void,
  ): void
  public addEventListener(
    topic: string,
    eventType: EventType.SecureChannelEstablished,
    callback: () => void,
  ): void
  public addEventListener(
    topic: string,
    eventType: EventType.MessageReceived,
    callback: (message: any) => void,
  ): void
  public addEventListener(
    topic: string,
    eventType: EventType.Error,
    callback: (error: string) => void,
  ): void
  public addEventListener(topic: string, eventType: EventType, callback: any): void {
    if (!this.eventListeners[topic]) {
      this.eventListeners[topic] = {
        [EventType.BridgeConnected]: [],
        [EventType.SecureChannelEstablished]: [],
        [EventType.MessageReceived]: [],
        [EventType.Error]: [],
      }
    }

    this.eventListeners[topic][eventType].push(callback)
  }

  /**
   * Emit an event for a specific topic and event type
   */
  public async emitBridgeConnected(topic: string): Promise<void> {
    if (!this.eventListeners[topic]) return
    await Promise.all(
      this.eventListeners[topic][EventType.BridgeConnected].map((callback) => callback(topic)),
    )
  }

  public async emitSecureChannelEstablished(topic: string): Promise<void> {
    if (!this.eventListeners[topic]) return
    await Promise.all(
      this.eventListeners[topic][EventType.SecureChannelEstablished].map((callback) => callback()),
    )
  }

  public async emitMessageReceived(topic: string, message: any): Promise<void> {
    if (!this.eventListeners[topic]) return
    await Promise.all(
      this.eventListeners[topic][EventType.MessageReceived].map((callback) => callback(message)),
    )
  }

  public async emitError(topic: string, error: string): Promise<void> {
    if (!this.eventListeners[topic]) return
    await Promise.all(
      this.eventListeners[topic][EventType.Error].map((callback) => callback(error)),
    )
  }

  /**
   * Remove all event listeners for a topic
   */
  public removeEventListeners(topic: string): void {
    delete this.eventListeners[topic]
  }

  /**
   * Clear all event listeners
   */
  public clearAllEventListeners(): void {
    this.eventListeners = {}
  }

  /**
   * Get all topics with registered event listeners
   */
  public getTopics(): string[] {
    return Object.keys(this.eventListeners)
  }
}
