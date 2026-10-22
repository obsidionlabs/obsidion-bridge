import { beforeEach, describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { bytesToHex } from "@noble/ciphers/utils"
import { encrypt, getSharedSecret } from "../src/encryption"
import { getEncryptedJsonPayload } from "../src/json-rpc"
import { Bridge, BridgeInterface, CreateOptions, JoinOptions } from "../src"
import { mockWebSocket, MockWebSocket, waitForCallback, delay, BRIDGE_URL } from "./helpers"

// The test hands frames to a socket directly, so it always runs on the in-memory transport
mock.module("../src/websocket", mockWebSocket)

setDefaultTimeout(10000)

const CREATE_OPTIONS: CreateOptions = { bridgeUrl: BRIDGE_URL, keepalive: false }
const JOIN_OPTIONS: JoinOptions = { bridgeUrl: BRIDGE_URL, keepalive: false }

/** Hand frames to a bridge's socket all at once, the way a replay from the server arrives. */
function deliver(bridge: BridgeInterface, ...frames: string[]) {
  const socket = bridge.connection.getWebSocket() as unknown as { receiveMessage(data: string): void }
  for (const frame of frames) socket.receiveMessage(frame)
}

/** A payload that barely compresses, so it is split into several chunks. */
function randomPayload(size: number): string {
  let payload = ""
  while (payload.length < size) payload += Math.random().toString(36).substring(2, 15)
  return payload
}

describe("Duplicate delivery", () => {
  beforeEach(() => {
    MockWebSocket.failNextConnections(0)
    MockWebSocket.delayConnections(10)
  })

  test("emits a chunked message once when its chunks arrive together", async () => {
    await using creator = await Bridge.create(CREATE_OPTIONS)
    const creatorSecure = waitForCallback(creator.onSecureChannelEstablished)
    await waitForCallback(creator.onConnect)
    await using joiner = await Bridge.join(creator.connectionString, JOIN_OPTIONS)
    await waitForCallback(joiner.onSecureChannelEstablished)
    await creatorSecure

    const received: any[] = []
    creator.onSecureMessage((message) => received.push(message))

    const payload = randomPayload(1024 * 256)
    const sharedSecret = getSharedSecret(joiner.getKeyPair().privateKey, creator.getPublicKey())
    const { chunks } = await getEncryptedJsonPayload("proof", { payload }, sharedSecret, creator.bridgeId)
    expect(chunks.length).toBeGreaterThan(1)

    deliver(creator, ...chunks)
    await delay(200)

    expect(received).toEqual([{ method: "proof", params: { payload } }])
  })

  test("holds encrypted frames that arrive before the replayed handshake", async () => {
    const original = await Bridge.create(CREATE_OPTIONS)
    await waitForCallback(original.onConnect)
    const keyPair = original.getKeyPair()
    const bridgeId = original.bridgeId
    original.close()

    const joinerKeyPair = await Bridge.generateKeyPair()
    const sharedSecret = getSharedSecret(joinerKeyPair.privateKey, keyPair.publicKey)
    const greeting = Buffer.from(await encrypt("hello", sharedSecret, bridgeId)).toString("hex")
    const handshake = JSON.stringify({
      jsonrpc: "2.0",
      id: "handshake-1",
      method: "handshake",
      params: { pubkey: bytesToHex(joinerKeyPair.publicKey), greeting },
    })
    const { chunks } = await getEncryptedJsonPayload("proof", { payload: "p" }, sharedSecret, bridgeId)

    const received: any[] = []
    const errors: string[] = []
    await using rebuilt = await Bridge.create({ ...CREATE_OPTIONS, keyPair, replayFrom: 1 })
    rebuilt.onSecureMessage((message) => received.push(message))
    rebuilt.onError((error) => errors.push(error))
    await waitForCallback(rebuilt.onConnect)

    // The live copy lands first, then the replay brings the handshake and the same frame again
    deliver(rebuilt, ...chunks, handshake, ...chunks)
    await delay(200)

    expect(errors).toEqual([])
    expect(received).toEqual([{ method: "proof", params: { payload: "p" } }])
  })
})
