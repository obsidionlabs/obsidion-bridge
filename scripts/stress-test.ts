import { BridgeHost, BridgeSubscriber } from "../src"
import debug from "debug"

// Enable debug logs
debug.enable("bridge:*")
const log = debug("bridge:example")

interface MessageStats {
  sent: number
  received: number
  dropped: number
  startTime: number
  endTime?: number
}

interface DirectionalStats {
  subscriberToHost: MessageStats
  hostToSubscriber: MessageStats
}

/**
 * This example demonstrates how to use Obsidion Bridge with a host and subscriber,
 * and how to stress test the bridge for potential message drops in both directions.
 */
async function main() {
  // Create a host instance (this would typically be your web app)
  const bridgeHost = new BridgeHost("https://localhost")

  // Connect to the bridge
  const {
    url,
    onBridgeConnect: onBridgeConnectHost,
    onSecureChannelEstablished: onSecureChannelEstablishedHost,
    onMessageReceived: onMessageReceivedHost,
    sendSecureMessage: sendSecureMessageHost,
  } = await bridgeHost.connect()

  log(`Connection URL: ${url}`)

  // Set up message tracking for both directions
  const stats: DirectionalStats = {
    subscriberToHost: {
      sent: 0,
      received: 0,
      dropped: 0,
      startTime: Date.now(),
    },
    hostToSubscriber: {
      sent: 0,
      received: 0,
      dropped: 0,
      startTime: Date.now(),
    },
  }

  // Set up event listeners for the host
  onBridgeConnectHost((topic) => {
    log(`Host connected to bridge on topic: ${topic}`)
  })
  onSecureChannelEstablishedHost(() => {
    log("Host established secure channel")
  })
  onMessageReceivedHost((message) => {
    stats.subscriberToHost.received++
    log(`Host received message ${stats.subscriberToHost.received}:`, message)
  })

  // Wait for the host to connect to the bridge server
  await waitForCallback(onBridgeConnectHost)

  // Create a subscriber instance (this would typically be your mobile app)
  const bridgeSubscriber = new BridgeSubscriber()

  // Connect to the bridge
  const {
    onBridgeConnect: onBridgeConnectSubscriber,
    onSecureChannelEstablished: onSecureChannelEstablishedSubscriber,
    onMessageReceived: onMessageReceivedSubscriber,
    sendSecureMessage: sendSecureMessageSubscriber,
  } = await bridgeSubscriber.connect(url!)

  // Set up event listeners for the subscriber
  onBridgeConnectSubscriber((topic) => {
    log(`Subscriber connected to bridge on topic: ${topic}`)
  })
  onSecureChannelEstablishedSubscriber(() => {
    log("Subscriber established secure channel")
  })
  onMessageReceivedSubscriber((message) => {
    if (message.method !== "hello") stats.hostToSubscriber.received++
    log(`Subscriber received message ${stats.hostToSubscriber.received}:`, message)
  })

  // Wait for the secure channel to be established
  await waitForCallback(onSecureChannelEstablishedSubscriber)

  // Log initial state before starting stress test
  log("\nInitial message counts:")
  log(`Host received: ${stats.subscriberToHost.received}`)
  log(`Subscriber received: ${stats.hostToSubscriber.received}`)

  // Stress test parameters
  const NUM_MESSAGES = 100
  const MESSAGE_INTERVAL_MS = 50 // 20 messages per second
  const TEST_DURATION_MS = 5000 // 5 seconds

  log(`\nStarting bidirectional stress test with ${NUM_MESSAGES} messages in each direction...`)

  // Start sending messages in both directions simultaneously
  const subscriberToHostPromise = (async () => {
    for (let i = 0; i < NUM_MESSAGES; i++) {
      const message = `Subscriber to Host message ${i + 1}/${NUM_MESSAGES}`
      stats.subscriberToHost.sent++
      const success = await sendSecureMessageSubscriber(message)
      if (!success) {
        stats.subscriberToHost.dropped++
        log(`Failed to send subscriber to host message ${i + 1}`)
      }
      await new Promise((resolve) => setTimeout(resolve, MESSAGE_INTERVAL_MS))
    }
  })()

  const hostToSubscriberPromise = (async () => {
    for (let i = 0; i < NUM_MESSAGES; i++) {
      const message = `Host to Subscriber message ${i + 1}/${NUM_MESSAGES}`
      stats.hostToSubscriber.sent++
      const success = await sendSecureMessageHost(message)
      if (!success) {
        stats.hostToSubscriber.dropped++
        log(`Failed to send host to subscriber message ${i + 1}`)
      }
      await new Promise((resolve) => setTimeout(resolve, MESSAGE_INTERVAL_MS))
    }
  })()

  // Wait for both sending operations to complete
  await Promise.all([subscriberToHostPromise, hostToSubscriberPromise])

  // Wait for messages to be received
  await new Promise((resolve) => setTimeout(resolve, TEST_DURATION_MS))

  // Calculate final statistics
  stats.subscriberToHost.endTime = Date.now()
  stats.hostToSubscriber.endTime = Date.now()

  // Log statistics for both directions
  log("\nStress Test Results:")
  log("-------------------")

  log("\nSubscriber to Host:")
  log(`Total messages sent: ${stats.subscriberToHost.sent}`)
  log(`Messages received by host: ${stats.subscriberToHost.received}`)
  log(`Messages dropped: ${stats.subscriberToHost.dropped}`)
  log(
    `Test duration: ${(stats.subscriberToHost.endTime - stats.subscriberToHost.startTime) / 1000} seconds`,
  )
  log(
    `Message rate: ${(stats.subscriberToHost.sent / ((stats.subscriberToHost.endTime - stats.subscriberToHost.startTime) / 1000)).toFixed(2)} messages/second`,
  )
  log(
    `Success rate: ${((stats.subscriberToHost.received / stats.subscriberToHost.sent) * 100).toFixed(2)}%`,
  )

  log("\nHost to Subscriber:")
  log(`Total messages sent: ${stats.hostToSubscriber.sent}`)
  log(`Messages received by subscriber: ${stats.hostToSubscriber.received}`)
  log(`Messages dropped: ${stats.hostToSubscriber.dropped}`)
  log(
    `Test duration: ${(stats.hostToSubscriber.endTime - stats.hostToSubscriber.startTime) / 1000} seconds`,
  )
  log(
    `Message rate: ${(stats.hostToSubscriber.sent / ((stats.hostToSubscriber.endTime - stats.hostToSubscriber.startTime) / 1000)).toFixed(2)} messages/second`,
  )
  log(
    `Success rate: ${((stats.hostToSubscriber.received / stats.hostToSubscriber.sent) * 100).toFixed(2)}%`,
  )

  // Clean up
  log("\nCleaning up...")
  bridgeSubscriber.closeAll()
  bridgeHost.closeAll()

  log("Bidirectional stress test completed!")
}

// Run the example
main().catch((error) => {
  console.error("Error running example:", error)
  process.exit(1)
})

async function waitForCallback(callback: (resolve: () => void) => void): Promise<any> {
  return new Promise<void>((resolve) => {
    return callback(resolve)
  })
}
