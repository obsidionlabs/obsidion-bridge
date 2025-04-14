import { Bridge } from "../../src"
import debug from "debug"

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

debug.enable("creator,joiner,bridge*")

// Creator-side example (typically a web application)
async function creatorExample() {
  const log = debug("creator")

  try {
    // Create a bridge connection as the creator
    const bridge = await Bridge.create({ debug: false })

    log("Bridge created. Connection string:", bridge.connectionString)

    // Set up event handlers
    bridge.onConnect((reconnection: boolean) => {
      console.log(`${reconnection ? "Reconnected" : "Connected"} to bridge`)
    })

    bridge.onSecureChannelEstablished(async () => {
      log("Secure channel established with joiner")

      await delay(1000)
      // Send a secure message to the joiner
      bridge.sendMessage("greeting", {
        message: "Hello from creator!",
      })
    })

    bridge.onSecureMessage((message) => {
      log("Received message from joiner:", message)
    })

    bridge.onError((error) => {
      log("Error: %o", error)
    })

    bridge.onDisconnect(() => {
      log("Disconnected from bridge")
    })

    // In a real application, you would keep the connection open
    // and close it only when done
    setTimeout(() => {
      log("Closing connection...")
      bridge.close()
    }, 60000) // Keep connection open for 1 minute

    return bridge
  } catch (error) {
    log("Error: %o", error)
  }
}

// Joiner-side example (typically a mobile app)
async function joinerExample(connectionString: string) {
  const log = debug("joiner")

  try {
    // Join an existing bridge connection using the connection string from the creator
    const bridge = await Bridge.join(connectionString, { debug: false })

    // Set up event handlers
    bridge.onConnect((reconnection: boolean) => {
      log(`${reconnection ? "Reconnected" : "Connected"} to bridge`)
      if (reconnection) {
        bridge.sendMessage("greeting", {
          message: "Hello I reconnected!",
        })
      }
    })

    bridge.onSecureChannelEstablished(() => {
      log("Secure channel established with creator")

      // Send a secure message to the creator
      bridge.sendMessage("greeting", {
        message: "Hello from joiner!",
      })
    })

    bridge.onSecureMessage((message) => {
      log("Received message from creator:", message)
    })

    bridge.onError((error) => {
      log("Error: %o", error)
    })

    bridge.onDisconnect(() => {
      log("Disconnected from bridge")
    })

    setTimeout(() => {
      log("Forcing websocket closed")
      bridge.websocket!.close()
    }, 5000)

    // In a real application, you would keep the connection open
    // and close it only when done
    setTimeout(() => {
      log("Closing connection...")
    }, 120000) // Keep connection open for 1 minute

    return bridge
  } catch (error) {
    log("Error: %o", error)
  }
}

// Example of running in a single process for demonstration
// In a real scenario, creator and joiner would be separate applications
async function runExample() {
  // Start creator
  const creatorBridge = await creatorExample()
  if (!creatorBridge) return

  // Wait a bit to ensure creator is connected
  await new Promise((resolve) => setTimeout(resolve, 1000))

  // Start joiner using the URL from the creator
  await joinerExample(creatorBridge.connectionString)
}

// Run the example if this file is executed directly
if (require.main === module) {
  runExample().catch(console.error)
}

export { creatorExample, joinerExample }
