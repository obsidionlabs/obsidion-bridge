import { randomBytes } from "crypto"
import { encrypt } from "./encryption"
import { WebSocketClient } from "./websocket"
import debug from "debug"

const log = debug("bridge")
const MAX_PAYLOAD_SIZE = 32768

export interface JsonRpcRequest {
  jsonrpc: string
  id: string
  origin?: string
  method: string
  params: any
}

export interface JsonRpcResponse {
  jsonrpc: string
  id: string
  result: any
}

export function createJsonRpcRequest(method: string, params: any): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: randomBytes(16).toString("hex"),
    method,
    params,
  }
}

export async function createEncryptedJsonRpcRequest(
  method: string,
  params: any,
  sharedSecret: Uint8Array,
  topic: string,
): Promise<JsonRpcRequest> {
  const encryptedMessage = await encrypt(
    JSON.stringify({ method, params: params || {} }),
    sharedSecret,
    topic,
  )
  return createJsonRpcRequest("encryptedMessage", {
    payload: Buffer.from(encryptedMessage).toString("base64"),
  })
}

export async function getEncryptedJsonPayload(
  method: string,
  params: any,
  sharedSecret: Uint8Array,
  nonce: string,
): Promise<string> {
  const message = JSON.stringify({ method, params: params || {} })
  const encryptedMessage = await encrypt(message, sharedSecret, nonce)
  const request = createJsonRpcRequest("encryptedMessage", {
    payload: Buffer.from(encryptedMessage).toString("base64"),
  })
  const payload = JSON.stringify(request)
  log(`Original message: ${message} (${message.length} bytes)`)
  log(`Encrypted message: ${payload} (${payload.length} bytes)`)
  return payload
}

export async function sendEncryptedJsonRpcRequest(
  method: string,
  params: any,
  sharedSecret: Uint8Array,
  nonce: string,
  websocket: WebSocketClient,
): Promise<boolean> {
  try {
    const payload = await getEncryptedJsonPayload(method, params, sharedSecret, nonce)
    if (payload.length > MAX_PAYLOAD_SIZE) {
      throw new Error(`Payload exceeds max size of ${MAX_PAYLOAD_SIZE} bytes`)
    }
    websocket.send(payload)
    return true
  } catch (error) {
    log("Error sending encrypted message:", error)
    return false
  }
}

export function createJsonRpcResponse(id: string, result: any): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  }
}
