"use client"
import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
// import { Bridge, BridgeInterface } from "@obsidion/bridge"
import { Bridge, BridgeInterface } from "../../../../.."
import { MessagesPanel } from "../components/MessagesPanel"
import debug from "debug"

debug.enable("bridge*")

export default function JoinBridgePage() {
  const searchParams = useSearchParams()
  const [connectionString, setConnectionString] = useState("")
  const [bridge, setBridge] = useState<BridgeInterface | null>(null)
  const [messages, setMessages] = useState<string[]>([])
  const [joinStatus, setJoinStatus] = useState<"idle" | "joining" | "connected">("idle")

  useEffect(() => {
    return () => {
      console.log("Component unmounted, closing bridge")
      bridge?.close()
    }
  }, [bridge])

  useEffect(() => {
    // Get URI from query parameters on page load
    const uriParam = searchParams.get("uri")
    if (uriParam) {
      setConnectionString(uriParam)
      console.log("Connection string:", uriParam)
      handleJoinBridge(uriParam)
    }
  }, [searchParams])

  const handleJoinBridge = async (connectionString: string) => {
    setJoinStatus("joining")
    try {
      const bridge = await Bridge.join(connectionString)
      setBridge(bridge)
      console.log("Bridge joined successfully", bridge)
      setJoinStatus("connected")

      // Listen for messages
      bridge.onMessage((message) => {
        setMessages((prev) => [...prev, `Received: ${JSON.stringify(message)}`])
        console.log("Message received:", message)
      })

      // Listen for connection events
      bridge.onConnect((reconnection: boolean) => {
        setMessages((prev) => [...prev, `${reconnection ? "Reconnected" : "Connected"} to bridge`])
        setJoinStatus("connected")
      })

      bridge.onDisconnect(() => {
        setMessages((prev) => [...prev, "Disconnected from bridge"])
        setJoinStatus("idle")
      })

      bridge.onSecureChannelEstablished(() => {
        setMessages((prev) => [
          ...prev,
          "Secure channel established",
          `Local public key: ${bridge.getPublicKey()}`,
          `Remote public key: ${bridge.getRemotePublicKey()}`,
        ])
      })

      bridge.onError((error) => {
        setMessages((prev) => [...prev, `Error: ${error}`])
        setJoinStatus("idle")
      })
    } catch (error: unknown) {
      console.error("Failed to join bridge:", error)
      setMessages((prev) => [
        ...prev,
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      ])
      setJoinStatus("idle")
    }
  }

  const handleSendMessage = (message: string) => {
    if (bridge && bridge.isBridgeConnected()) {
      bridge.sendMessage(message)
      setMessages((prev) => [...prev, `Sent: ${message}`])
    } else {
      setMessages((prev) => [...prev, "Cannot send message: Bridge not connected"])
    }
  }

  return (
    <div className="flex flex-col items-center justify-start min-h-screen p-4 pt-8">
      <h1 className="text-3xl font-bold mb-8">Join Bridge</h1>

      <div className="mb-8 w-full max-w-[800px]">
        <p className="mb-2 font-medium">Connection String:</p>
        <div className="flex gap-2">
          <input
            id="connectionString"
            type="text"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            className="flex-1 p-3 border rounded bg-background text-foreground text-sm"
            placeholder="Enter connection string"
          />
          <button
            onClick={() => handleJoinBridge(connectionString)}
            className="px-4 py-3 bg-foreground text-background font-medium rounded hover:bg-foreground/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={joinStatus !== "idle"}
          >
            {joinStatus === "joining"
              ? "Joining..."
              : joinStatus === "connected"
                ? "Connected"
                : "Join"}
          </button>
        </div>
      </div>

      <MessagesPanel
        messages={messages}
        onSendMessage={handleSendMessage}
        defaultMessage="hello from joiner!"
      />
    </div>
  )
}
