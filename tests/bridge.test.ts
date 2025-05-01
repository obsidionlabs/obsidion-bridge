import { describe, test, expect, mock } from "bun:test"
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils"
import { getSharedSecret } from "../src/encryption"
import { Bridge } from "../src"
import { mockWebSocket, waitForCallback } from "./helpers"

// Enable debug logging for tests
import debug from "debug"
debug.enable("bridge:*")

// Mock the websocket module
// Set USE_REAL_BRIDGE_SERVER=1 to test against the real bridge server
if (!process.env.USE_REAL_BRIDGE_SERVER) mock.module("../src/websocket", mockWebSocket)

// This is the fixed keypair for test consistency
const keyPairFrontend = {
  privateKey: hexToBytes("aff05bedec7aaf1ae09628bf81ab50cb025587de29ef99d65ede2b9137a8e6fd"),
  publicKey: hexToBytes("02d3ff5e5db7c48c34880bc11e8b457a4b9a6bf2a2f545cf575eb941b08f04adc4"),
}
const keyPairMobile = {
  privateKey: hexToBytes("5af6bf929ab3b5e2f5720804bec6e6f21e2bddc359d33b37aebd3bcdc55ed80e"),
  publicKey: hexToBytes("03ca2d5fb061bc822e1a45c598eddc08069c37fefe096047a90a7ff9cb7db488aa"),
}

describe("Bridge", () => {
  test("should connect to bridge and establish secure channel", async () => {
    const creator = await Bridge.create()
    const onCreatorSecureChannelEstablished = waitForCallback(creator.onSecureChannelEstablished)

    await waitForCallback(creator.onConnect)
    expect(creator.isBridgeConnected()).toBe(true)

    const joiner = await Bridge.join(creator.connectionString)
    const onJoinerSecureChannelEstablished = waitForCallback(joiner.onSecureChannelEstablished)

    await waitForCallback(joiner.onConnect)
    expect(joiner.isBridgeConnected()).toBe(true)

    await onCreatorSecureChannelEstablished
    expect(creator.isSecureChannelEstablished()).toBe(true)

    await onJoinerSecureChannelEstablished
    expect(joiner.isSecureChannelEstablished()).toBe(true)
  }, 5000)

  test(`should use custom keypairs`, async () => {
    const creator = await Bridge.create({ keyPair: keyPairFrontend })
    const joiner = await Bridge.join(creator.connectionString, { keyPair: keyPairMobile })

    await waitForCallback(joiner.onSecureChannelEstablished)

    expect(creator.connectionString).toStartWith(
      "obsidion:02d3ff5e5db7c48c34880bc11e8b457a4b9a6bf2a2f545cf575eb941b08f04adc4",
    )
    expect(joiner.connectionString).toStartWith(
      "obsidion:02d3ff5e5db7c48c34880bc11e8b457a4b9a6bf2a2f545cf575eb941b08f04adc4",
    )
    const sharedSecret = await getSharedSecret(keyPairFrontend.privateKey, keyPairMobile.publicKey)
    expect(bytesToHex(sharedSecret)).toBe(
      "02bc79c530fe88c0473087e4e31f8a186704c1ddedd9cc450a00f4f3582364c1",
    )
  }, 5000)

  test("should use custom origin", async () => {
    const creator = await Bridge.create({ origin: "https://localhost" })
    const joiner = await Bridge.join(creator.connectionString)

    expect(creator.origin).toBe("https://localhost")
    expect(creator.connectionString).toContain("d=https://localhost")
    expect(joiner.origin).toBe("https://localhost")
    expect(joiner.connectionString).toContain("d=https://localhost")
  })

  test("should fail to verify incorrect origin", async () => {
    const creator = await Bridge.create({ origin: "https://actual-origin.com" })
    const joiner = await Bridge.join(
      creator.connectionString.replace("actual-origin.com", "wrong-origin.com"),
    )

    expect(creator.connectionString).toContain("d=https://actual-origin.com")
    expect(creator.origin).toBe("https://actual-origin.com")
    expect(joiner.origin).toBe("https://wrong-origin.com")

    const error = await waitForCallback(joiner.onError)
    expect(error).toContain("origin")
  })

  test("should send messages over bridge", async () => {
    const creator = await Bridge.create()
    const joiner = await Bridge.join(creator.connectionString)

    // Wait for the secure channel to be established
    const creatorOnMessage = waitForCallback(creator.onSecureMessage)
    const joinerOnMessage = waitForCallback(joiner.onSecureMessage)

    if (!process.env.USE_REAL_BRIDGE_SERVER) {
      // I don't know why, but mock needs this and live fails with it
      await waitForCallback(joiner.onSecureChannelEstablished)
    }
    await waitForCallback(creator.onSecureChannelEstablished)

    // Set up listeners for messages before sending any messages
    creator.sendMessage("hello, world?", {})
    const message1 = await joinerOnMessage
    expect(message1).toEqual({ method: "hello, world?", params: {} })

    joiner.sendMessage("hello, world!", {})
    const message2 = await creatorOnMessage
    expect(message2).toEqual({ method: "hello, world!", params: {} })
  }, 10000)

  test("should handle reconnect on disconnect", async () => {
    const creator = await Bridge.create()
    const joiner = await Bridge.join(creator.connectionString)

    await waitForCallback(joiner.onSecureChannelEstablished)
    expect(joiner.isSecureChannelEstablished()).toBe(true)

    expect(joiner.isBridgeConnected()).toBe(true)
    joiner.websocket!.close()
    expect(joiner.isBridgeConnected()).toBe(false)

    await waitForCallback(joiner.onConnect)
    expect(joiner.isBridgeConnected()).toBe(true)

    const creatorOnMessage = waitForCallback(creator.onSecureMessage)
    joiner.sendMessage("after reconnect", {})
    const message = await creatorOnMessage
    expect(message).toEqual({ method: "after reconnect", params: {} })
  })

  test("should correctly set config options", async () => {
    const creator1 = await Bridge.create()
    // @ts-expect-error private property
    expect(creator1.connection.reconnect).toBe(true)
    expect(creator1.connection.keepalive).toBe(true)
    expect(creator1.websocket?.readyState).toBe(WebSocket.CONNECTING)

    const creator2 = await Bridge.create({ autoconnect: false, reconnect: false, keepalive: false })
    // @ts-expect-error private property
    expect(creator2.connection.reconnect).toBe(false)
    expect(creator2.connection.keepalive).toBe(false)
    expect(creator2.websocket?.readyState).not.toBe(WebSocket.CONNECTING)

    const joiner1 = await Bridge.join(creator1.connectionString)
    // @ts-expect-error private property
    expect(joiner1.connection.reconnect).toBe(true)
    expect(joiner1.connection.keepalive).toBe(true)

    const joiner2 = await Bridge.join(creator2.connectionString, {
      reconnect: false,
      keepalive: false,
    })
    // @ts-expect-error private property
    expect(joiner2.connection.reconnect).toBe(false)
    expect(joiner2.connection.keepalive).toBe(false)
  })

  test("should correctly resume as joiner", async () => {
    const creator = await Bridge.create()
    const joiner = await Bridge.join(creator.connectionString)

    await waitForCallback(joiner.onSecureChannelEstablished)
    expect(joiner.isSecureChannelEstablished()).toBe(true)

    // Create a new joiner resuming the session
    const resumedJoiner = await Bridge.join(creator.connectionString, {
      resume: true,
      keyPair: joiner.getKeyPair(),
    })
    await waitForCallback(resumedJoiner.onSecureChannelEstablished)
    expect(resumedJoiner.isSecureChannelEstablished()).toBe(true)

    // Verify message exchange after resuming
    const creatorOnMessage = waitForCallback(creator.onSecureMessage)
    resumedJoiner.sendMessage("resumed joiner", {})
    const message = await creatorOnMessage
    expect(message).toEqual({ method: "resumed joiner", params: {} })
  })

  test("should correctly resume as creator", async () => {
    const creator = await Bridge.create()
    const joiner = await Bridge.join(creator.connectionString)

    await waitForCallback(joiner.onSecureChannelEstablished)
    expect(joiner.isSecureChannelEstablished()).toBe(true)

    // Create a new creator resuming the session
    const resumedCreator = await Bridge.create({
      resume: true,
      keyPair: creator.getKeyPair(),
      remotePublicKey: hexToBytes(creator.getRemotePublicKey()),
    })
    await waitForCallback(resumedCreator.onSecureChannelEstablished)
    expect(resumedCreator.isSecureChannelEstablished()).toBe(true)

    // Verify message exchange after resuming
    const joinerOnMessage = waitForCallback(joiner.onSecureMessage)
    resumedCreator.sendMessage("resumed creator", {})
    const message = await joinerOnMessage
    expect(message).toEqual({ method: "resumed creator", params: {} })
  })

  test("payload size", async () => {
    const creator = await Bridge.create()
    const joiner = await Bridge.join(creator.connectionString)

    if (!process.env.USE_REAL_BRIDGE_SERVER) {
      // I don't know why, but mock needs this and live fails with it
      await waitForCallback(joiner.onSecureChannelEstablished)
    }
    await waitForCallback(creator.onSecureChannelEstablished)

    const creatorOnMessage = waitForCallback(creator.onSecureMessage)
    const joinerOnMessage = waitForCallback(joiner.onSecureMessage)

    // Try payload under max chunk size
    let payloadSize = 128
    let payload = ""
    while (JSON.stringify({ data: payload }).length < payloadSize) {
      payload += Math.random().toString(36).substring(2, 15)
    }
    await creator.sendMessage("small_payload", { payload })
    const message1 = await joinerOnMessage
    expect(message1).toEqual({ method: "small_payload", params: { payload } })

    // Try payload over max chunk size
    payloadSize = 1024 * 256
    payload = ""
    while (JSON.stringify({ data: payload }).length < payloadSize) {
      payload += Math.random().toString(36).substring(2, 15)
    }
    joiner.sendMessage("big_payload", { payload })
    const message2 = await creatorOnMessage
    expect(message2).toEqual({ method: "big_payload", params: { payload } })
  }, 20000)
})
