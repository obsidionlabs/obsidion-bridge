import { BridgeHost, BridgeSubscriber } from "../src"
import debug from "debug"

// Enable debug logs
debug.enable("bridge:*")
const log = debug("bridge:example")

/**
 * This example demonstrates how to use Obsidion Bridge with a host and subscriber,
 * and how to send messages between them.
 */
async function main() {
  // Create a host instance (this would typically be your web app)
  // The origin doesn't need to be specified when used in the browser
  const bridgeHost = new BridgeHost("https://localhost")

  // Connect to the bridge
  const {
    topic,
    url,
    onBridgeConnect: onBridgeConnectHost,
    onSecureChannelEstablished: onSecureChannelEstablishedHost,
    onMessageReceived: onMessageReceivedHost,
  } = await bridgeHost.connect()

  log(`Connection URL: ${url}`)

  // Set up event listeners for the host
  onBridgeConnectHost((topic) => {
    log(`Host connected to bridge on topic: ${topic}`)
  })
  onSecureChannelEstablishedHost(() => {
    log("Host established secure channel")
  })
  onMessageReceivedHost((message) => {
    log("Host received a message:", message)
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
    sendSecureMessage,
  } = await bridgeSubscriber.connect(url!)

  // Set up event listeners for the subscriber
  onBridgeConnectSubscriber((topic) => {
    log(`Subscriber connected to bridge on topic: ${topic}`)
  })
  onSecureChannelEstablishedSubscriber(() => {
    log("Subscriber established secure channel")
  })
  onMessageReceivedSubscriber((message) => {
    log("Subscriber received a message:", message)
  })

  // Wait for the secure channel to be established
  await waitForCallback(onSecureChannelEstablishedSubscriber)

  // Send a message securely from the subscriber to the host
  log("Secure channel established, sending message from subscriber to host...")
  const success = await sendSecureMessage("hello, world!")
  log(`Message sent successfully: ${success}`)

  // Keep the process running for a bit to allow the message to be received
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Clean up
  log("Cleaning up...")
  bridgeSubscriber.closeAll()
  bridgeHost.closeAll()

  log("Example completed successfully!")
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
