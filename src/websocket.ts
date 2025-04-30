export function getWebSocketClient(url: string, origin?: string) {
  if (typeof window !== "undefined" && window.WebSocket) {
    // Browser environment
    return new WebSocket(url)
  } else {
    // Node.js environment
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WebSocket = require("ws")
    // return new WebSocket(url, {
    //   headers: {
    //     Origin: origin || "nodejs",
    //   },
    // }) as import("ws").WebSocket
    return new WebSocket(url, {
      headers: {
        Origin: origin || "nodejs",
      },
      maxPayload: 1024 * 1024, // Default to 128KB if not specified
    }) as import("ws").WebSocket
  }
}

export type WebSocketClient = ReturnType<typeof getWebSocketClient>
