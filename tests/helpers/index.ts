export { mockWebSocket, MockWebSocket } from "./mock-websocket"

// Bridge endpoint used when running against a real server (USE_REAL_BRIDGE_SERVER=1).
// Ignored in mock mode. Override with the BRIDGE_URL env var.
export const BRIDGE_URL = process.env.BRIDGE_URL ?? "wss://bridge-staging.zkpassport.id"

export const waitForCallback = <T = any>(callback: (resolve: (value?: T) => void) => void): Promise<T> => {
  return new Promise<T>((resolve) => callback(resolve as (value?: T) => void))
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
