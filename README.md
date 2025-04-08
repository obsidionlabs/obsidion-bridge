# Bridge Connection API

This library provides a secure websocket bridge connection between two parties using end-to-end encryption.

## Installation

```bash
bun install @obsidion/bridge
```

## Usage

The bridge creates a secure encrypted communication channel between two parties:

1. **Creator** - The party that creates the bridge connection and shares the connection string
2. **Joiner** - The party that joins using the shared connection string

### Creator Side (typically a frontend web app)

```typescript
import { Bridge } from "@obsidion/bridge"

// Create a bridge
const bridge = await Bridge.create()

// The connection string URI to share with the joiner (can be encoded as a QR code)
console.log("Bridge connection string:", bridge.connectionString)

// Set up event handlers
const unsubscribeConnect = bridge.onConnect(() => {
  console.log(`Connected to bridge`)
})

const unsubscribeSecureChannel = bridge.onSecureChannelEstablished(() => {
  console.log("Secure channel established with joiner")

  // Now we can send secure messages
  bridge.sendSecureMessage("greeting", { message: "Hello from creator!" })
})

const unsubscribeMessage = bridge.onMessage((message) => {
  console.log("Received message:", message)
})

// Example of unsubscribing from an event
// This can be useful when used with React hooks
unsubscribeMessage()

bridge.onDisconnect(() => {
  console.log("Disconnected from bridge")
})

bridge.onReconnect(() => {
  console.log(`Reconnected to bridge`)
})

bridge.onError((error) => {
  console.error(`Error: ${error}`)
})

// Close the bridge when done
bridge.close()

// ... later, when cleaning up:
unsubscribeConnect()
unsubscribeSecureChannel()
```

### Joiner Side (typically a mobile app)

```typescript
import { Bridge } from "@obsidion/bridge"

// Join using the connection string shared by the creator
// This is typically obtained from scanning a QR code
const cs = "obsidion:02d3ff5e5db7c48c34880bc11e8b457a4b9a6bf2a2f545cf575eb941b08f04adc4?d=localhost"
const bridge = await Bridge.join(cs)

// Set up event handlers
const unsubscribeConnect = bridge.onConnect(() => {
  console.log(`Connected to bridge`)
})

const unsubscribeSecureChannel = bridge.onSecureChannelEstablished(() => {
  console.log("Secure channel established with creator")

  // Now we can send secure messages
  bridge.sendSecureMessage("greeting", { message: "Hello from joiner!" })
})

const unsubscribeMessage = bridge.onMessage((message) => {
  console.log("Received message:", message)
})

// Unsubscribe functions can be called at any time to stop listening to events
// This can be useful when used with React hooks
unsubscribeMessage()

bridge.onDisconnect(() => {
  console.log("Disconnected from bridge")
})

bridge.onReconnect(() => {
  console.log(`Reconnected to bridge`)
})

bridge.onError((error) => {
  console.error(`Error: ${error}`)
})

// Close the bridge when done
bridge.close()
```
