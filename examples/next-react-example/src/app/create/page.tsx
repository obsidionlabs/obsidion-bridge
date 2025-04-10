"use client"
import { useEffect, useState } from "react"
// import { Bridge } from "@obsidion/bridge"
import { Bridge } from "../../../../../dist/esm"
import { MessagesPanel } from "../components/MessagesPanel"
import debug from "debug"
import { getConnectionState, isRefreshed, saveRemotePublicKey } from "@/utils"
import { hexToBytes } from "@noble/ciphers/utils"

debug.enable("bridge*")

// Define the bridge interface type
type BridgeInterface = ReturnType<typeof Bridge.create> extends Promise<infer T> ? T : never

export default function CreateBridgePage() {
  const [bridge, setBridge] = useState<BridgeInterface | null>(null)
  const [connectionString, setConnectionString] = useState<string>("")
  const [messages, setMessages] = useState<string[]>([])

  useEffect(() => {
    const createBridge = async () => {
      const connectionState = await getConnectionState("creator")
      const bridge = await Bridge.create({
        keyPair: connectionState.keyPair,
        // TODO: this might be too optimistic
        // even if remote pubkey is found in local storage ( connected = true ) and isRefreshed() returns true,
        // the actual connection might not be established
        resume: connectionState.connected && isRefreshed(),
      })

      setBridge(bridge)
      setConnectionString(bridge.connectionString)
      console.log("Bridge created. Connection string:", bridge.connectionString)

      if (connectionState.remotePublicKey) {
        console.log("Setting remote public key:", connectionState.remotePublicKey)
        bridge.setRemotePublicKey(hexToBytes(connectionState.remotePublicKey))
        await bridge.computeSharedSecret()
      }

      // Listen for messages
      bridge.onMessage((message) => {
        setMessages((prev) => [...prev, `Received: ${JSON.stringify(message)}`])
        console.log("Message received:", message)
      })

      // Listen for connection events
      bridge.onConnect(() => {
        setMessages((prev) => [...prev, "Connected to bridge"])
      })

      bridge.onSecureChannelEstablished(() => {
        console.log("Secure channel established")
        setMessages((prev) => [
          ...prev,
          "Secure channel established",
          `Remote public key: ${bridge.getRemotePublicKey()}`,
          `Local public key: ${bridge.getPublicKey()}`,
        ])
        saveRemotePublicKey(bridge.getRemotePublicKey(), "creator")
      })

      bridge.onError((error) => {
        setMessages((prev) => [...prev, `Error: ${error}`])
      })
    }
    createBridge()
  }, [])

  const handleJoin = () => {
    window.open(`/join?uri=${encodeURIComponent(connectionString)}`, "_blank")
  }

  const handleSendMessage = async (message: string, params: object) => {
    if (bridge && bridge.isBridgeConnected()) {
      if (await bridge.sendMessage(message, params)) {
        setMessages((prev) => [...prev, `Sent: ${message} ${JSON.stringify(params)}`])
      }
    } else {
      setMessages((prev) => [...prev, "Cannot send message: Bridge not connected"])
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-8">Create Bridge</h1>
      {connectionString && (
        <div className="mb-8 w-full max-w-[800px]">
          <p className="mb-2 font-medium">Connection String:</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={connectionString}
              readOnly
              className="flex-1 p-3 border rounded bg-background text-foreground text-sm"
            />
            <button
              onClick={handleJoin}
              className="px-4 py-3 bg-foreground text-background font-medium rounded hover:bg-foreground/90 transition"
            >
              Open in Join Page
            </button>
          </div>
        </div>
      )}

      <MessagesPanel
        messages={messages}
        onSendMessage={handleSendMessage}
        defaultMessage="hello from creator!"
      />
    </div>
  )
}
