import { beforeEach, describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { getSharedSecret } from "../src/encryption"
import { getEncryptedJsonPayload } from "../src/json-rpc"
import { Bridge, BridgeInterface, CreateOptions, JoinOptions } from "../src"
import { mockWebSocket, MockWebSocket, waitForCallback, delay, BRIDGE_URL } from "./helpers"

// These tests push frames straight into a receiving socket, the way the relay does
// when it replays a bridge's cached messages, so they always run on the in-memory
// transport rather than against a real bridge server.
mock.module("../src/websocket", mockWebSocket)

setDefaultTimeout(10000)

const CREATE_OPTIONS: CreateOptions = { bridgeUrl: BRIDGE_URL, keepalive: false }
const JOIN_OPTIONS: JoinOptions = { bridgeUrl: BRIDGE_URL, keepalive: false }

/** Deliver frames to a bridge's current socket, all within one tick, as a replay burst does. */
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

const proofs = (received: any[]) => received.filter((message) => message.method === "proof")

describe("Duplicate delivery", () => {
  beforeEach(() => {
    MockWebSocket.failNextConnections(0)
    MockWebSocket.delayConnections(10)
    MockWebSocket.clearMessages()
  })

  test("emits a single-part message once when its frame is delivered twice", async () => {
    await using creator = await Bridge.create(CREATE_OPTIONS)
    const creatorSecure = waitForCallback(creator.onSecureChannelEstablished)
    await waitForCallback(creator.onConnect)
    await using joiner = await Bridge.join(creator.connectionString, JOIN_OPTIONS)
    await waitForCallback(joiner.onSecureChannelEstablished)
    await creatorSecure

    const received: any[] = []
    creator.onSecureMessage((message) => received.push(message))
    const frames: string[] = []
    creator.onRawMessage((raw: string) => frames.push(raw))

    frames.length = 0 // from here on, only the frames of the message under test
    await joiner.sendMessage("proof", { index: 1 })
    await delay(50)
    expect(frames).toHaveLength(1)

    deliver(creator, ...frames)
    await delay(50)

    expect(proofs(received)).toEqual([{ method: "proof", params: { index: 1 } }])
  })

  test("emits a chunked message once when its frames are delivered twice", async () => {
    await using creator = await Bridge.create(CREATE_OPTIONS)
    const creatorSecure = waitForCallback(creator.onSecureChannelEstablished)
    await waitForCallback(creator.onConnect)
    await using joiner = await Bridge.join(creator.connectionString, JOIN_OPTIONS)
    await waitForCallback(joiner.onSecureChannelEstablished)
    await creatorSecure

    const received: any[] = []
    creator.onSecureMessage((message) => received.push(message))
    const frames: string[] = []
    creator.onRawMessage((raw: string) => frames.push(raw))

    frames.length = 0
    const payload = randomPayload(1024 * 256)
    await joiner.sendMessage("proof", { payload })
    await delay(100)
    expect(frames.length).toBeGreaterThan(1)

    // One frame per tick, so this isolates duplicate frames from concurrent reassembly.
    // Every chunk here arrives after the message was reassembled and dropped.
    for (const frame of [...frames]) {
      deliver(creator, frame)
      await delay(2)
    }
    await delay(100)

    expect(proofs(received)).toEqual([{ method: "proof", params: { payload } }])
    // @ts-expect-error private property
    expect(creator.connection.incompleteMessages.size).toBe(0) // no half-built message left behind
  })

  test("emits a chunked message once when its chunks arrive in the same tick", async () => {
    await using creator = await Bridge.create(CREATE_OPTIONS)
    const creatorSecure = waitForCallback(creator.onSecureChannelEstablished)
    await waitForCallback(creator.onConnect)
    await using joiner = await Bridge.join(creator.connectionString, JOIN_OPTIONS)
    await waitForCallback(joiner.onSecureChannelEstablished)
    await creatorSecure

    const received: any[] = []
    creator.onSecureMessage((message) => received.push(message))

    // Build the chunks the joiner would send, then hand them over in one burst
    const payload = randomPayload(1024 * 256)
    const sharedSecret = getSharedSecret(joiner.getKeyPair().privateKey, creator.getPublicKey())
    const { chunks } = await getEncryptedJsonPayload("proof", { payload }, sharedSecret, creator.bridgeId)
    expect(chunks.length).toBeGreaterThan(1)

    deliver(creator, ...chunks)
    await delay(200)

    expect(proofs(received)).toEqual([{ method: "proof", params: { payload } }])
  })

  test("emits each message once when a reconnect replays a half-sent chunked message", async () => {
    await using creator = await Bridge.create(CREATE_OPTIONS)
    const creatorSecure = waitForCallback(creator.onSecureChannelEstablished)
    await waitForCallback(creator.onConnect)
    await using joiner = await Bridge.join(creator.connectionString, JOIN_OPTIONS)
    await waitForCallback(joiner.onSecureChannelEstablished)
    await creatorSecure

    const received: any[] = []
    creator.onSecureMessage((message) => received.push(message))

    // Drop the creator's socket mid-stream and keep it down until the joiner has
    // sent the rest. On reconnect the relay replays the bridge in one burst: the
    // chunks the creator already saw, and every chunk it missed.
    MockWebSocket.delayConnections(150)
    const payload = randomPayload(1024 * 256)
    const sent = joiner.sendMessage("proof", { payload })
    await delay(3)
    creator.connection.getWebSocket()!.close()
    await sent
    await delay(500)

    expect(proofs(received)).toEqual([{ method: "proof", params: { payload } }])
  })
})
