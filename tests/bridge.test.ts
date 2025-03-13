import { describe, beforeEach, afterEach, test, expect, jest, mock } from "bun:test"
import { hexToBytes } from "@noble/ciphers/utils"
import { getSharedSecret } from "../src/encryption"
import { BridgeHost, BridgeSubscriber, sendEncryptedJsonRpcRequest } from "../src"
import { MockWebSocket, waitForCallback } from "./helpers"
import debug from "debug"

const log = debug("bridge:test")

const topic = "abc456012312301230123"
const keyPairFrontend = {
  privateKey: hexToBytes("aff05bedec7aaf1ae09628bf81ab50cb025587de29ef99d65ede2b9137a8e6fd"),
  publicKey: hexToBytes("02d3ff5e5db7c48c34880bc11e8b457a4b9a6bf2a2f545cf575eb941b08f04adc4"),
}
const keyPairMobile = {
  privateKey: hexToBytes("5af6bf929ab3b5e2f5720804bec6e6f21e2bddc359d33b37aebd3bcdc55ed80e"),
  publicKey: hexToBytes("03ca2d5fb061bc822e1a45c598eddc08069c37fefe096047a90a7ff9cb7db488aa"),
}

const QR_CODE_URL = `https://zkpassport.id/r?d=localhost&t=${topic}&p=02d3ff5e5db7c48c34880bc11e8b457a4b9a6bf2a2f545cf575eb941b08f04adc4`

// This is a mock function that mimics the behavior of the bridge server on client connect
const mockBridgeServerClientConnect = function () {
  // If the WebSocket URI used to connect contains a pubkey param, the server will automatically
  // broadcast a handshake message to all connected clients
  if (this.url) {
    const url = new URL(this.url)
    const pubkey = url.searchParams.get("pubkey")
    const greeting = url.searchParams.get("greeting")
    if (pubkey && greeting) {
      setTimeout(async () => {
        log("Server broadcast pubkey handshake (from WS URI)")
        this.send(
          JSON.stringify({
            method: "handshake",
            params: { pubkey, greeting },
          }),
        )
      }, 100)
    }
  }
}

// This is a mock function that mimics the behavior of the bridge server on message relay
const mockBridgeServerMessageRelay = function (data: string): string | undefined {
  // The WebSocket server will parse the data as JSON and throw error if invalid
  let parsedData: any
  try {
    parsedData = JSON.parse(data)
  } catch (error) {
    throw new Error("Invalid JSON: " + error.message)
  }
  // The WebSocket server will set the origin property on every message relayed if the origin is set
  if (this.origin) parsedData.origin = this.origin
  return JSON.stringify(parsedData)
}

// Mock the websocket module
// Comment this out to test against the real bridge server
mock.module("../src/websocket", () => {
  return {
    getWebSocketClient: jest.fn((url: string, origin: string) => {
      const websocket = new MockWebSocket(url, {
        headers: { Origin: origin },
        hubChannel: topic,
        onConnectInterceptor: mockBridgeServerClientConnect,
        onSendInterceptor: mockBridgeServerMessageRelay,
      })
      return websocket
    }),
  }
})

describe("Bridge", () => {
  let bridgeSubscriber: BridgeSubscriber
  let bridgeFrontend: BridgeHost

  beforeEach(async () => {
    bridgeSubscriber = new BridgeSubscriber()
    bridgeFrontend = new BridgeHost("https://localhost")
  })

  afterEach(() => {
    MockWebSocket.clearHub()
    bridgeSubscriber.closeAll()
    bridgeFrontend.closeAll()
  })

  test("should connect to websocket bridge and establish secure channel", async () => {
    const {
      onBridgeConnect: onBridgeConnectFrontend,
      isBridgeConnected: isBridgeConnectedFrontend,
      onSecureChannelEstablished: onSecureChannelEstablishedFrontend,
      isSecureChannelEstablished: isSecureChannelEstablishedFrontend,
    } = await bridgeFrontend.connect({
      keyPair: keyPairFrontend,
      topic: topic,
    })
    const onSecureChannelEstablishedFrontendCallback = waitForCallback(
      onSecureChannelEstablishedFrontend,
    )

    // Wait for the bridge to connect (frontend)
    await waitForCallback(onBridgeConnectFrontend)
    expect(isBridgeConnectedFrontend()).toBe(true)

    const {
      onBridgeConnect,
      isBridgeConnected,
      onSecureChannelEstablished,
      isSecureChannelEstablished,
    } = await bridgeSubscriber.connect(QR_CODE_URL, {
      keyPair: keyPairMobile,
    })

    const onSecureChannelEstablishedCallback = waitForCallback(onSecureChannelEstablished)

    // Wait for the bridge to connect (mobile)
    await waitForCallback(onBridgeConnect)
    expect(isBridgeConnected()).toBe(true)

    // Wait for the secure channel to be established (frontend)
    await onSecureChannelEstablishedFrontendCallback
    expect(isSecureChannelEstablishedFrontend()).toBe(true)

    // Wait for the secure channel to be established (mobile)
    await onSecureChannelEstablishedCallback
    expect(isSecureChannelEstablished()).toBe(true)
  }, 60000)

  test("should send messages over websocket bridge", async () => {
    const { websocket: websocketFrontend, onMessageReceived: onMessageReceivedFrontend } =
      await bridgeFrontend.connect({
        keyPair: keyPairFrontend,
        topic: topic,
      })

    const {
      websocket: websocketMobile,
      onSecureChannelEstablished,
      isSecureChannelEstablished,
      onMessageReceived,
    } = await bridgeSubscriber.connect(QR_CODE_URL, {
      keyPair: keyPairMobile,
    })

    await waitForCallback(onSecureChannelEstablished)
    expect(isSecureChannelEstablished()).toBe(true)

    // Send a message over the secure channel
    const sharedSecret = await getSharedSecret(keyPairFrontend.privateKey, keyPairMobile.publicKey)
    const expectedMessage1 = { method: "hello, world?", params: {} }
    await sendEncryptedJsonRpcRequest("hello, world?", null, sharedSecret, topic, websocketMobile)
    const messageReceived1 = await waitForCallback(onMessageReceivedFrontend)
    expect(messageReceived1).toEqual(expectedMessage1)

    const expectedMessage2 = { method: "hello, world!", params: {} }
    await sendEncryptedJsonRpcRequest("hello, world!", null, sharedSecret, topic, websocketFrontend)
    const messageReceived2 = await waitForCallback(onMessageReceived)
    expect(messageReceived2).toEqual(expectedMessage2)
  }, 60000)
})
