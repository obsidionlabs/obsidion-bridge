// Import type only to avoid bundling issues
import type { WebSocket as WSWebSocket } from "ws"

/**
 * Creates a WebSocket client that works in both browser and Node.js environments
 */
export async function getWebSocketClient(url: string, origin?: string): Promise<WebSocket | WSWebSocket> {
  // Browser environment - use native WebSocket
  if (
    (typeof window !== "undefined" && window.WebSocket) ||
    (typeof globalThis !== "undefined" && globalThis.WebSocket) ||
    (typeof global !== "undefined" && global.WebSocket)
  ) {
    return new WebSocket(url)
  }

  // Node.js environment - use ws package
  try {
    // Dynamic import of the ws module
    const wsModule = await import("ws").catch(() => {
      // Fallback to require for CommonJS environments
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return { default: require("ws") }
      } catch {
        throw new Error("WebSocket implementation 'ws' not found. Please install it with: npm install ws")
      }
    })

    // Get the WebSocket constructor
    const WebSocketImpl = wsModule.default || (wsModule as any).WebSocket || wsModule

    return new WebSocketImpl(url, { headers: { Origin: origin || "nodejs" } }) as WSWebSocket
  } catch (error) {
    console.error("Failed to create WebSocket client:", error)
    throw new Error("WebSocket implementation 'ws' not found. Please install it with: npm install ws")
  }
}

// WebSocketClient type
export type WebSocketClient = Awaited<ReturnType<typeof getWebSocketClient>>
