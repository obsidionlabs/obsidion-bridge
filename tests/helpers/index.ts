export { MockWebSocket } from "./mock-websocket"
export async function waitForCallback(callback: (resolve: () => void) => void): Promise<any> {
  return new Promise<void>((resolve) => {
    return callback(resolve)
  })
}
