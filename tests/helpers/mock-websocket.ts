import { jest } from "bun:test"

export class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  // Static hub to manage connections between MockWebSocket instances
  private static hub: Map<string, MockWebSocket[]> = new Map()

  // Static storage for bridge origins (keyed by bridge ID)
  private static bridgeOrigins: Map<string, string> = new Map()

  // Static store of cached messages per bridge channel (for replay)
  private static messages: Map<string, { data: string; timestamp: number }[]> = new Map()

  onopen: (() => void) | null = null
  onmessageHandlers: ((event: { data: string }) => void)[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  oncloseHandlers: ((event: { code: number; reason: string }) => void)[] = []
  private readyState: number
  private url: string
  public origin: string | null = null
  private receivedMessages: string[] = []
  private hubChannel: string | null = null
  private onConnectInterceptor: (() => void) | null = null
  private onSendInterceptor: ((data: string) => string | undefined) | null = null
  // One replay allowed per connection (per MockWebSocket instance)
  private replayRequested = false

  private static connectionsToFail = 0

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
    } = {}
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
      if (MockWebSocket.connectionsToFail > 0) {
        MockWebSocket.connectionsToFail--
        this.close(1006, "Connection failed")
        return
      }
      this.readyState = MockWebSocket.OPEN
      if (this.onConnectInterceptor) this.onConnectInterceptor()
      if (this.onopen) this.onopen()
    }, 10)
  }

  // Make the next `count` connections close without ever opening, like when the network is unreachable
  static failNextConnections(count: number) {
    MockWebSocket.connectionsToFail = count
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

    // Parse to detect replay requests and to decide whether to cache the message
    let parsed: any
    try {
      parsed = JSON.parse(data)
    } catch {
      parsed = null
    }

    // Replay requests are handled by the (mock) server and never relayed to peers
    if (parsed && parsed.method === "replay") {
      this.handleReplay(parsed)
      return
    }

    // Cache the message for later replay (mirrors the bridge server's message
    // store). `nocache` messages (e.g. ping/pong) are relayed but not stored.
    if (this.hubChannel && parsed && !parsed.nocache) {
      const log = MockWebSocket.messages.get(this.hubChannel) ?? []
      log.push({ data, timestamp: Date.now() })
      MockWebSocket.messages.set(this.hubChannel, log)
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

  // Handle a replay request: resend the messages cached for this channel since
  // the requested timestamp (oldest first), then a `replay_complete` confirmation.
  // One replay per connection; invalid timestamps are rejected. This mirrors the
  // bridge server's replay logic.
  private handleReplay(parsed: any) {
    const frames: string[] = []

    if (this.replayRequested) {
      frames.push(
        JSON.stringify({
          error: "replay_already_requested",
          message: "Replay can only be requested once per connection",
        })
      )
    } else {
      const ts = parsed?.params?.timestamp
      if (typeof ts !== "number" || !Number.isInteger(ts) || ts <= 0) {
        frames.push(
          JSON.stringify({ error: "invalid_timestamp", message: "Invalid timestamp provided for replay request" })
        )
      } else {
        this.replayRequested = true
        const log = (this.hubChannel && MockWebSocket.messages.get(this.hubChannel)) || []
        const missed = log.filter((m) => m.timestamp > ts) // already oldest-first (push order)
        for (const m of missed) frames.push(m.data)
        frames.push(JSON.stringify({ status: "replay_complete", count: missed.length }))
      }
    }

    // Deliver asynchronously, in order, to mimic a server response over the network
    setTimeout(() => {
      for (const data of frames) {
        if (this.onmessage) this.onmessage({ data })
        for (const handler of this.onmessageHandlers) handler({ data })
      }
    }, 0)
  }

  // Method to handle incoming messages
  private receiveMessage(data: string) {
    // Ignore messages that are not valid JSON
    // TODO: Consider disconnecting here instead
    let parsed: any
    try {
      parsed = JSON.parse(data)
    } catch {
      console.log("Ignoring invalid JSON message:", data)
      return
    }

    // Replay requests are handled by the (mock) server in send() and are never
    // relayed to peers; ignore any that somehow reach a peer.
    if (parsed && parsed.method === "replay") {
      return
    }

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

  close(code = 1000, reason = "Normal closure") {
    // Only trigger close events if the socket was open
    const wasOpen = this.readyState === MockWebSocket.OPEN
    const wasConnecting = this.readyState === MockWebSocket.CONNECTING

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

    // Trigger close events if the socket was previously open or never managed to open
    if (wasOpen || wasConnecting) {
      this.triggerCloseHandlers(code, reason)
    }
  }

  // Method to simulate a server-side disconnect
  simulateServerDisconnect(code = 1006, reason = "Server closed connection") {
    if (this.readyState === MockWebSocket.OPEN) {
      this.readyState = MockWebSocket.CLOSED

      // Trigger close handlers
      this.triggerCloseHandlers(code, reason)

      // Remove from hub but don't affect other connections
      if (this.hubChannel && MockWebSocket.hub.has(this.hubChannel)) {
        const sockets = MockWebSocket.hub.get(this.hubChannel) || []
        const index = sockets.indexOf(this)
        if (index !== -1) {
          sockets.splice(index, 1)
        }
      }
    }
  }

  // Helper to trigger all close handlers
  private triggerCloseHandlers(code: number, reason: string) {
    const closeEvent = { code, reason }

    if (this.onclose) {
      this.onclose(closeEvent)
    }

    for (const handler of this.oncloseHandlers) {
      handler(closeEvent)
    }
  }

  addEventListener(event: string, callback: (event: any) => void) {
    if (event === "open") {
      this.onopen = callback as () => void
    } else if (event === "message") {
      this.onmessageHandlers.push(callback as (event: { data: string }) => void)
    } else if (event === "close") {
      this.oncloseHandlers.push(callback as (event: { code: number; reason: string }) => void)
    }
  }

  removeEventListener(event: string, callback: (event: any) => void) {
    if (event === "open" && this.onopen === callback) {
      this.onopen = null
    } else if (event === "message") {
      this.onmessageHandlers = this.onmessageHandlers.filter((h) => h !== callback)
    } else if (event === "close") {
      this.oncloseHandlers = this.oncloseHandlers.filter((h) => h !== callback)
    }
  }

  getReadyState() {
    return this.readyState
  }

  // Static method to clear all hub connections (useful for test cleanup)
  static clearHub() {
    MockWebSocket.hub.clear()
  }

  // Static method to store a bridge origin
  static storeBridgeOrigin(bridgeId: string, origin: string) {
    MockWebSocket.bridgeOrigins.set(bridgeId, origin)
  }

  // Static method to get a bridge origin
  static getBridgeOrigin(bridgeId: string): string | undefined {
    return MockWebSocket.bridgeOrigins.get(bridgeId)
  }

  // Static method to clear all bridge origins (useful for test cleanup)
  static clearBridgeOrigins() {
    MockWebSocket.bridgeOrigins.clear()
  }

  // Static method to clear all cached messages (useful for test cleanup)
  static clearMessages() {
    MockWebSocket.messages.clear()
  }

  // Number of live sockets in a channel (useful for deterministic tests)
  static channelSize(channel: string): number {
    return MockWebSocket.hub.get(channel)?.length ?? 0
  }

  // Static method to simulate a server-side disconnect for all connections in a channel
  static simulateServerDisconnectForChannel(channel: string, code = 1006, reason = "Server closed connection") {
    if (MockWebSocket.hub.has(channel)) {
      const sockets = [...(MockWebSocket.hub.get(channel) || [])]
      for (const socket of sockets) {
        socket.simulateServerDisconnect(code, reason)
      }
    }
  }
}

// This is a mock function that mimics the behavior of the bridge server on client connect
const mockBridgeServerClientConnect = function () {
  // If the WebSocket connection URI contains a `moc` (message on connect) param,
  // the server will automatically broadcast it to the bridge on connect
  if (this.url) {
    const url = new URL(this.url)
    const bridgeId = url.searchParams.get("id") || url.searchParams.get("topic") || ""

    // Disconnect if no bridge ID is specified
    if (!bridgeId) {
      setTimeout(() => {
        this.simulateServerDisconnect(1008, "Missing bridge ID")
      }, 5)
      return
    }

    // If client has an origin and there's no stored origin, store it (creator)
    if (this.origin && !MockWebSocket.getBridgeOrigin(bridgeId)) {
      MockWebSocket.storeBridgeOrigin(bridgeId, this.origin)
    }

    // Origin on connect (ooc) - if present, send the bridge origin to client
    if (url.searchParams.has("ooc")) {
      const storedOrigin = MockWebSocket.getBridgeOrigin(bridgeId)
      if (storedOrigin) {
        setTimeout(() => {
          // Send origin as a JSON-RPC notification
          const originMessage = JSON.stringify({ jsonrpc: "2.0", method: "ooc", params: { origin: storedOrigin } })
          // Directly trigger the message handler (don't broadcast to other sockets)
          if (this.onmessage) this.onmessage({ data: originMessage })
          for (const handler of this.onmessageHandlers) {
            handler({ data: originMessage })
          }
        }, 5)
      }
    }

    // Message on connect (moc) - if present, decode and treat as incoming message
    const moc = url.searchParams.get("moc")
    if (moc) {
      try {
        // Decode the base64 encoded message (URL decode first, then base64)
        const decodedMessage = atob(decodeURIComponent(moc)).trim()
        if (!decodedMessage) {
          // Simulate server disconnect on error
          setTimeout(() => {
            this.simulateServerDisconnect(1008, "Empty message on connect")
          }, 5)
          return
        }

        // Simulate message on connect message sending
        setTimeout(async () => {
          this.send(decodedMessage)
        }, 10)
      } catch {
        // Simulate server disconnect on error
        setTimeout(() => {
          this.simulateServerDisconnect(1008, "Invalid message on connect")
        }, 5)
      }
    }
  }
}

// This is a mock function that mimics the behavior of the bridge server on message relay
const mockBridgeServerMessageRelay = function (data: string): string | undefined {
  // The WebSocket server will parse the data as JSON and throw error if invalid
  let parsedData: any
  try {
    parsedData = JSON.parse(data)
  } catch (error) {
    throw new Error("Invalid JSON: " + error.message)
  }
  // The WebSocket server will set the origin property on every message relayed if the origin is set
  if (this.origin) parsedData.origin = this.origin
  return JSON.stringify(parsedData)
}

export const mockWebSocket = () => {
  return {
    getWebSocketClient: jest.fn((url: string, origin: string) => {
      // Extract bridge id from url for use in MockWebSocket
      const urlObj = new URL(url)
      const bridgeIdFromUrl = urlObj.searchParams.get("id") || urlObj.searchParams.get("topic") || ""
      const websocket = new MockWebSocket(url, {
        headers: { Origin: origin },
        hubChannel: bridgeIdFromUrl, // Use id from URL
        onConnectInterceptor: mockBridgeServerClientConnect,
        onSendInterceptor: mockBridgeServerMessageRelay,
      })
      return websocket
    }),
  }
}
