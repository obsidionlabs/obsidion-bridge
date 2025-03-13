export class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  // Static hub to manage connections between MockWebSocket instances
  private static hub: Map<string, MockWebSocket[]> = new Map()

  onopen: (() => void) | null = null
  onmessageHandlers: ((event: { data: string }) => void)[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  private readyState: number
  private url: string
  public origin: string | null = null
  private receivedMessages: string[] = []
  private hubChannel: string | null = null
  private onConnectInterceptor: (() => void) | null = null
  private onSendInterceptor: ((data: string) => string | undefined) | null = null

  constructor(
    url: string,
    {
      headers,
      hubChannel,
      onConnectInterceptor,
      onSendInterceptor,
    }: {
      headers?: Record<string, string>
      hubChannel?: string
      onConnectInterceptor?: () => void
      onSendInterceptor?: (data: string) => string | undefined
    } = {},
  ) {
    this.url = url
    this.readyState = MockWebSocket.CONNECTING
    this.origin = headers?.Origin || null
    this.hubChannel = hubChannel || null
    this.onConnectInterceptor = onConnectInterceptor || null
    this.onSendInterceptor = onSendInterceptor || null

    // Register with hub if a channel is specified
    if (this.hubChannel) {
      if (!MockWebSocket.hub.has(this.hubChannel)) {
        MockWebSocket.hub.set(this.hubChannel, [])
      }
      MockWebSocket.hub.get(this.hubChannel)?.push(this)
    }

    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      if (this.onConnectInterceptor) this.onConnectInterceptor()
      if (this.onopen) this.onopen()
    }, 10)
  }

  send(data: string) {
    // Don't send messages if the socket is closed
    if (this.readyState !== MockWebSocket.OPEN) {
      return
    }

    if (this.onSendInterceptor) {
      const result = this.onSendInterceptor(data)
      // Use the interceptor's return value as the new data if provided
      if (result !== undefined) {
        data = result
      }
    }

    // If connected to a hub, relay the message to other sockets in the same channel
    if (this.hubChannel && MockWebSocket.hub.has(this.hubChannel)) {
      const connectedSockets = MockWebSocket.hub.get(this.hubChannel) || []

      // Send to all other sockets in the same channel
      for (const socket of connectedSockets) {
        if (socket !== this && socket.getReadyState() === MockWebSocket.OPEN) {
          socket.receiveMessage(data)
        }
      }
    }
  }

  // Method to handle incoming messages
  private receiveMessage(data: string) {
    this.receivedMessages.push(data)

    // Trigger message handlers
    if (this.onmessage) {
      this.onmessage({ data })
    }

    for (const handler of this.onmessageHandlers) {
      handler({ data })
    }
  }

  // Method to wait for a message to be received
  async waitForMessage(timeout = 1000): Promise<string> {
    if (this.receivedMessages.length > 0) {
      return this.receivedMessages.shift()!
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timeout waiting for message"))
      }, timeout)

      const messageHandler = (event: { data: string }) => {
        clearTimeout(timeoutId)
        this.onmessageHandlers = this.onmessageHandlers.filter((h) => h !== messageHandler)
        resolve(event.data)
      }

      this.onmessageHandlers.push(messageHandler)
    })
  }

  close() {
    this.readyState = MockWebSocket.CLOSED

    // Remove from hub if connected
    if (this.hubChannel && MockWebSocket.hub.has(this.hubChannel)) {
      const sockets = MockWebSocket.hub.get(this.hubChannel) || []
      const index = sockets.indexOf(this)
      if (index !== -1) {
        sockets.splice(index, 1)
      }

      // Clean up empty channels
      if (sockets.length === 0) {
        MockWebSocket.hub.delete(this.hubChannel)
      }
    }
  }

  addEventListener(event: string, callback: ((event: { data: string }) => void) | (() => void)) {
    if (event === "open") {
      this.onopen = callback as () => void
    } else if (event === "message") {
      this.onmessageHandlers.push(callback as (event: { data: string }) => void)
    }
  }

  getReadyState() {
    return this.readyState
  }

  // Static method to clear all hub connections (useful for test cleanup)
  static clearHub() {
    MockWebSocket.hub.clear()
  }
}
