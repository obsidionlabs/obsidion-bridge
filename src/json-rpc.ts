import { getRandomBytes } from "./crypto"
import { encrypt } from "./encryption"
import { WebSocketClient } from "./websocket"
import debug from "debug"
import * as pako from "pako"

const log = debug("bridge")
const MAX_PAYLOAD_SIZE = 32 * 1024 // 32KB (AWS API Gateway limit)
const CHUNK_SIZE = 1024 * 16 // when to chunk uncompressed payloads
const CHUNK_WAIT = 50 // 50ms wait between sending chunks to avoid flooding network

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
  const randBytes = getRandomBytes(16)
  const id = Array.from(randBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  return {
    jsonrpc: "2.0",
    id,
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
  const compressed = pako.deflate(message)
  const messageToEncrypt = JSON.stringify({
    data: Buffer.from(compressed).toString("base64"),
  })
  log(`Compressed message from ${message.length} bytes to ${messageToEncrypt.length} bytes`)

  const encryptedMessage = await encrypt(messageToEncrypt, sharedSecret, topic)
  return createJsonRpcRequest("encryptedMessage", {
    payload: Buffer.from(encryptedMessage).toString("base64"),
  })
}

export async function getEncryptedJsonPayload(
  method: string,
  params: any,
  sharedSecret: Uint8Array,
  nonce: string,
): Promise<string[]> {
  // Split the encrypted message into chunks
  const chunks: string[] = []
  if (params) {
    const compressed = Buffer.from(pako.deflate(JSON.stringify(params))).toString("base64")
    const numChunks = Math.ceil(compressed.length / CHUNK_SIZE)
    console.log("NUM CHUNKS", numChunks);
    const id = Array.from(getRandomBytes(16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    for (let i = 0; i < numChunks; i++) {
      const startIndex = i * CHUNK_SIZE
      const endIndex = Math.min(startIndex + CHUNK_SIZE, compressed.length)
      const chunk = compressed.slice(startIndex, endIndex)
      const messageToEncrypt = JSON.stringify({
        method,
        params: chunk,
        chunk: {
          id,
          index: i,
          length: numChunks,
        },
      })
      const encryptedMessage = await encrypt(messageToEncrypt, sharedSecret, nonce)

      const request = createJsonRpcRequest("encryptedMessage", {
        payload: Buffer.from(encryptedMessage).toString("base64"),
      })
      chunks.push(JSON.stringify(request))
    }
  } else {
    const message = JSON.stringify({ method, params: params || {} })
    const encryptedMessage = await encrypt(message, sharedSecret, nonce)
    const request = createJsonRpcRequest("encryptedMessage", {
      payload: Buffer.from(encryptedMessage).toString("base64"),
    })
    chunks.push(JSON.stringify(request))
  }
  return chunks
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
    for (const payloadChunk of payload) {
      if (payloadChunk.length > MAX_PAYLOAD_SIZE) {
        // handle chunking payload
        throw new Error(`Payload exceeds max size of ${MAX_PAYLOAD_SIZE} bytes`)
      }
      websocket.send(payloadChunk)
      // avoid flooding network - wait 50ms between sending chunks
      await new Promise((resolve) => setTimeout(resolve, CHUNK_WAIT))
    }
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
