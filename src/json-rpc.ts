import { randomBytes } from "crypto"
import { encrypt } from "./encryption"
import { WebSocketClient } from "./websocket"
import debug from "debug"
import * as pako from "pako"

const log = debug("bridge")
const MAX_PAYLOAD_SIZE = 32768
const COMPRESSION_THRESHOLD = 1024 // Only compress payloads larger than 1KB

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
  const message = JSON.stringify({ method, params: params || {} })
  const compressed = pako.deflate(message);
  const messageToEncrypt = JSON.stringify({
    data: Buffer.from(compressed).toString("base64")
  });
  const encryptedMessage = await encrypt(
    messageToEncrypt,
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
  // compress message
  const message = JSON.stringify({ method, params: params || {} })
  const compressed = pako.deflate(message);
  const messageToEncrypt = JSON.stringify({
    data: Buffer.from(compressed).toString("base64")
  });
  log(`Compressed message from ${message.length} bytes to ${messageToEncrypt.length} bytes`);

  const encryptedMessage = await encrypt(messageToEncrypt, sharedSecret, nonce)
  const request = createJsonRpcRequest("encryptedMessage", {
    payload: Buffer.from(encryptedMessage).toString("base64"),
  })
  const payload = JSON.stringify(request)
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
