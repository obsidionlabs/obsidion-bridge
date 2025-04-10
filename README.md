# Obsidion Bridge

Obsidion Bridge provides a secure websocket connection between two parties using end-to-end encryption.

## Installation

```bash
bun install @obsidion/bridge
```

## Usage

The bridge creates a secure encrypted communication channel via ECDH between two parties:

1. **Creator** - The party that creates the bridge connection and shares the connection string. This will typically be a frontend web app.
2. **Joiner** - The party that joins the bridge using the connection string. This will typically be a mobile app.

### Bridge Creator

```typescript
import { Bridge } from "@obsidion/bridge"

// Create a bridge
const bridge = await Bridge.create()

// The connection string URI to share with the joiner (can be encoded as a QR code)
console.log("Bridge connection string:", bridge.connectionString)

// Set up event handlers
bridge.onConnect((reconnection: boolean) => {
  console.log(`${reconnection ? "Reconnected" : "Connected"} to bridge`)
})

bridge.onSecureChannelEstablished(() => {
  console.log("Secure channel established with joiner")

  // Now we can send secure messages
  bridge.sendSecureMessage("greeting", { message: "Hello from creator!" })
})

bridge.onMessage((message) => {
  console.log("Received message:", message)
})

bridge.onDisconnect(() => {
  console.log("Disconnected from bridge")
})

bridge.onError((error) => {
  console.error(`Error: ${error}`)
})

// Close the bridge when done
bridge.close()
```

### Bridge Joiner

```typescript
import { Bridge } from "@obsidion/bridge"

// Join using the connection string shared by the creator
// This is typically obtained from scanning a QR code
const cs = "obsidion:02d3ff5e5db7c48c34880bc11e8b457a4b9a6bf2a2f545cf575eb941b08f04adc4?d=localhost"
const bridge = await Bridge.join(cs)

// Set up event handlers
bridge.onConnect((reconnection: boolean) => {
  console.log(`${reconnection ? "Reconnected" : "Connected"} to bridge`)
})

bridge.onSecureChannelEstablished(() => {
  console.log("Secure channel established with creator")

  // Now we can send secure messages
  bridge.sendSecureMessage("greeting", { message: "Hello from joiner!" })
})

bridge.onMessage((message) => {
  console.log("Received message:", message)
})

bridge.onDisconnect(() => {
  console.log("Disconnected from bridge")
})

bridge.onError((error) => {
  console.error(`Error: ${error}`)
})

// Close the bridge when done
bridge.close()
```
