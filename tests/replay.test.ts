import { describe, test, expect, mock, afterEach, setDefaultTimeout } from "bun:test"
import { Bridge, CreateOptions, JoinOptions } from "../src"
import { mockWebSocket, waitForCallback, delay, BRIDGE_URL } from "./helpers"

// Swap the websocket transport for the in-memory mock unless USE_REAL_BRIDGE_SERVER=1,
// in which case the real client connects to bridgeUrl. These tests are transport-
// agnostic: they exercise replay through the same getWebSocketClient the Bridge uses,
// so they behave identically against the mock or a real bridge server.
if (!process.env.USE_REAL_BRIDGE_SERVER) mock.module("../src/websocket", mockWebSocket)

setDefaultTimeout(10000)

const CREATE_OPTIONS: CreateOptions = { bridgeUrl: BRIDGE_URL, keepalive: false }
const JOIN_OPTIONS: JoinOptions = { bridgeUrl: BRIDGE_URL, keepalive: false }

// A fresh bridge id per test so runs never collide (on the mock or a shared server).
const bridgeId = () => `replay-${crypto.randomUUID()}`

interface RawSocket {
  onopen: (() => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: string, cb: (event: any) => void): void
  removeEventListener(type: string, cb: (event: any) => void): void
}

const openSockets: RawSocket[] = []
afterEach(() => {
  for (const ws of openSockets.splice(0))
    try {
      ws.close()
    } catch {
      // ignore
    }
})

/** Open a raw connection through the configured transport (mock or real client). */
async function rawConnect(id: string, origin: string): Promise<RawSocket> {
  const { getWebSocketClient } = await import("../src/websocket")
  const ws = (await getWebSocketClient(`${BRIDGE_URL}?id=${id}&v=1`, origin)) as unknown as RawSocket
  openSockets.push(ws)
  await new Promise<void>((resolve) => {
    ws.onopen = () => resolve()
  })
  return ws
}

const send = (ws: RawSocket, obj: unknown) => ws.send(JSON.stringify(obj))
const msg = (id: string, payload: string) => ({ jsonrpc: "2.0", id, method: "encryptedMessage", params: { payload } })

// Send several cacheable messages, spaced so each lands on a distinct server
// timestamp. A server that keys cached messages by millisecond (e.g. the AWS
// bridge) would otherwise overwrite messages that arrive in the same millisecond.
async function sendStored(ws: RawSocket, ...objs: unknown[]) {
  for (const obj of objs) {
    send(ws, obj)
    await delay(10)
  }
}

/** Send a replay request and collect frames up to (and including) replay_complete. */
function requestReplay(ws: RawSocket, since: number, timeoutMs = 5000): Promise<{ messages: any[]; count: number }> {
  return new Promise((resolve, reject) => {
    const messages: any[] = []
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => {
      clearTimeout(timer)
      ws.removeEventListener("message", onMessage)
      ws.removeEventListener("close", onClose)
    }
    const onMessage = (event: { data: string }) => {
      const data = JSON.parse(event.data)
      if (data.status === "replay_complete") {
        cleanup()
        resolve({ messages, count: data.count })
      } else if (data.error) {
        cleanup()
        const err = new Error(data.error) as Error & { code: string }
        err.code = data.error
        reject(err)
      } else {
        messages.push(data)
      }
    }
    // Always settle, so a stalled/dropped reply can never hang the test run.
    const onClose = () => {
      cleanup()
      reject(new Error("connection closed before replay completed"))
    }
    timer = setTimeout(() => {
      cleanup()
      reject(new Error("replay timed out"))
    }, timeoutMs)
    ws.addEventListener("message", onMessage)
    ws.addEventListener("close", onClose)
    ws.send(JSON.stringify({ method: "replay", params: { timestamp: since } }))
  })
}

describe("Message replay", () => {
  test("replays cached messages since a timestamp, oldest first, with a count", async () => {
    const id = bridgeId()
    const sender = await rawConnect(id, "https://sender.example")
    await sendStored(sender, msg("m1", "AAA"), msg("m2", "BBB"), msg("m3", "CCC"))
    await delay(100)

    const late = await rawConnect(id, "https://late.example")
    const { messages, count } = await requestReplay(late, 1)

    expect(count).toBe(3)
    expect(messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"])
    // Re-delivered verbatim, with the sender's origin injected.
    expect(messages[0]).toEqual({
      jsonrpc: "2.0",
      id: "m1",
      method: "encryptedMessage",
      params: { payload: "AAA" },
      origin: "https://sender.example",
    })
  })

  test("does not replay nocache messages (e.g. ping/pong)", async () => {
    const id = bridgeId()
    const sender = await rawConnect(id, "https://sender.example")
    send(sender, msg("keep", "X"))
    send(sender, { method: "ping", params: {}, nocache: true })
    send(sender, { jsonrpc: "2.0", id: "keep2", method: "pong", params: {}, nocache: true })
    await delay(100)

    const late = await rawConnect(id, "https://late.example")
    const { messages, count } = await requestReplay(late, 1)
    expect(count).toBe(1)
    expect(messages.map((m) => m.id)).toEqual(["keep"])
  })

  test("injects the sender origin into replayed messages (anti-spoofing)", async () => {
    const id = bridgeId()
    const sender = await rawConnect(id, "https://real.example")
    // Client tries to forge a different origin; the server must overwrite it.
    send(sender, {
      jsonrpc: "2.0",
      id: "m1",
      method: "encryptedMessage",
      params: { payload: "Z" },
      origin: "https://evil.example",
    })
    await delay(100)

    const late = await rawConnect(id, "https://late.example")
    const { messages } = await requestReplay(late, 1)
    expect(messages[0].origin).toBe("https://real.example")
  })

  test("returns replay_complete with count 0 when nothing matches", async () => {
    const id = bridgeId()
    const sender = await rawConnect(id, "https://sender.example")
    send(sender, msg("old", "A"))
    await delay(100)

    const late = await rawConnect(id, "https://late.example")
    const { messages, count } = await requestReplay(late, Date.now() + 3_600_000) // far future => nothing
    expect(count).toBe(0)
    expect(messages).toHaveLength(0)
  })

  test("only allows one replay per connection", async () => {
    const id = bridgeId()
    const sender = await rawConnect(id, "https://sender.example")
    send(sender, msg("m1", "A"))
    await delay(100)

    const client = await rawConnect(id, "https://late.example")
    const first = await requestReplay(client, 1)
    expect(first.count).toBe(1)

    // A second replay on the same connection must be refused. Servers signal this
    // differently — the bridge replies with a replay_already_requested error, the
    // AWS bridge closes the connection — but it must never return a fresh replay.
    await expect(requestReplay(client, 1)).rejects.toThrow(/replay_already_requested|connection closed/)
  })

  test("rejects invalid timestamps", async () => {
    for (const bad of [0, -1, 1.5]) {
      const c = await rawConnect(bridgeId(), "https://late.example")
      await expect(requestReplay(c, bad as number)).rejects.toMatchObject({ code: "invalid_timestamp" })
    }
  })

  test("scopes replay to the requesting connection's bridge", async () => {
    const idA = bridgeId()
    const idB = bridgeId()
    const a = await rawConnect(idA, "https://a.example")
    send(a, msg("a1", "A"))
    const b = await rawConnect(idB, "https://b.example")
    send(b, msg("b1", "B"))
    await delay(100)

    const lateB = await rawConnect(idB, "https://late.example")
    const { messages } = await requestReplay(lateB, 1)
    expect(messages.map((m) => m.id)).toEqual(["b1"]) // never sees bridge A's message
  })

  test("does not deliver the replay request or replayed messages to peers", async () => {
    const id = bridgeId()
    // A peer stores messages while alone, then stays connected and watches.
    const peer = await rawConnect(id, "https://peer.example")
    await sendStored(peer, msg("m1", "A"), msg("m2", "B"))
    await delay(100)
    const peerFrames: any[] = []
    peer.addEventListener("message", (e) => peerFrames.push(JSON.parse(e.data)))

    const requester = await rawConnect(id, "https://late.example")
    const { count } = await requestReplay(requester, 1)
    expect(count).toBe(2)
    await delay(100) // grace for any (unwanted) delivery to arrive

    expect(peerFrames).toHaveLength(0) // peer received neither the request nor the replayed messages
  })
})

// ---------------------------------------------------------------------------
// Client-level: the Bridge requests replay automatically on reconnect.
// ---------------------------------------------------------------------------

function onceSecureMessage(
  bridge: { onSecureMessage: (cb: (m: any) => void) => () => void },
  method: string
): Promise<any> {
  return new Promise((resolve) => {
    const off = bridge.onSecureMessage((m: any) => {
      if (m && m.method === method) {
        off()
        resolve(m)
      }
    })
  })
}

describe("Message replay (on reconnect)", () => {
  test("messages still flow after a reconnect triggers a replay", async () => {
    await using creator = await Bridge.create(CREATE_OPTIONS)
    const creatorSecure = waitForCallback(creator.onSecureChannelEstablished)
    await waitForCallback(creator.onConnect)

    await using joiner = await Bridge.join(creator.connectionString, JOIN_OPTIONS)
    await waitForCallback(joiner.onSecureChannelEstablished)
    await creatorSecure

    // Closing the socket triggers an automatic reconnect, which requests a replay
    // under the hood. Messaging must continue to work afterwards.
    joiner.websocket!.close()
    await waitForCallback(joiner.onConnect)

    const echoed = onceSecureMessage(creator, "after-reconnect")
    await joiner.sendMessage("after-reconnect", { ok: true })
    expect(await echoed).toEqual({ method: "after-reconnect", params: { ok: true } })
  })
})
