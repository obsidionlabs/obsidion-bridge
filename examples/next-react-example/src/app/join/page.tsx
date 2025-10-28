"use client"
import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
// import { Bridge, BridgeInterface } from "@obsidion/bridge"
import { Bridge, BridgeInterface } from "../../../../../src/bridge"
import { restoreBridgeSession, saveBridgeSession, clearBridgeSession } from "../../lib/session"
import { MessagesPanel } from "../components/MessagesPanel"
import { CopyIcon } from "../components/CopyIcon"
import debug from "debug"
import { FailedToConnectEvent } from "../../../../../src/types"

debug.enable("bridge*")

function JoinBridgeContent() {
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
      // Resume bridge session if available
      const savedBridgeSession = restoreBridgeSession()
      const resume = savedBridgeSession ? true : false
      if (resume) {
        setMessages((prev) => [...prev, "Resuming bridge session"])
      }
      console.log("savedBridgeSession", savedBridgeSession)

      // Join bridge (and resume using saved bridge session if available)
      const bridge = await Bridge.join(connectionString, {
        keyPair: savedBridgeSession?.keyPair,
        resume,
        bridgeUrl: "wss://bridge-staging.zkpassport.id",
      })
      setBridge(bridge)
      setJoinStatus("connected")

      bridge.onSecureChannelEstablished(() => {
        setMessages((prev) => [
          ...prev,
          "Secure channel established",
          `Local public key: ${bridge.getPublicKey()}`,
          `Remote public key: ${bridge.getRemotePublicKey()}`,
        ])
        // Save bridge session data (keypair) for resuming
        saveBridgeSession(bridge.getKeyPair())
      })

      bridge.onRawMessage((message: unknown) => {
        setMessages((prev) => [...prev, `Raw message received: ${message}`])
        console.log("Raw message received:", message)
      })

      bridge.onSecureMessage((message: unknown) => {
        setMessages((prev) => [...prev, `Message received: ${JSON.stringify(message)}`])
        console.log("Message received:", message)
      })

      bridge.onConnect((reconnection: boolean) => {
        setMessages((prev) => [...prev, `${reconnection ? "Reconnected" : "Connected"} to bridge`])
        setJoinStatus("connected")
      })

      bridge.onFailedToConnect((event: FailedToConnectEvent) => {
        setMessages((prev) => [...prev, `Failed to connect to bridge: ${event.code} "${event.reason}"`])
        setJoinStatus("idle")
      })

      bridge.onDisconnect(() => {
        setMessages((prev) => [...prev, "Disconnected from bridge"])
        setJoinStatus("idle")
      })

      bridge.onError((error: string) => {
        setMessages((prev) => [...prev, `Error: ${error}`])
        setJoinStatus("idle")
      })
    } catch (error: unknown) {
      console.error("Failed to join bridge:", error)
      setMessages((prev) => [...prev, `Error: ${error instanceof Error ? error.message : "Unknown error"}`])
      setJoinStatus("idle")
    }
  }

  const handleSendMessage = (method: string) => {
    if (bridge && bridge.isBridgeConnected()) {
      bridge.sendMessage(method, {})
      setMessages((prev) => [...prev, `Sent: ${method}`])
    } else {
      setMessages((prev) => [...prev, "Cannot send message: Bridge not connected"])
    }
  }

  const handleClearSession = () => {
    clearBridgeSession()
    setMessages((prev) => [...prev, "Session cleared from storage"])
  }

  const handleCopyConnectionString = async () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(connectionString)
        setMessages((prev) => [...prev, "Connection string copied to clipboard"])
      } catch (error) {
        setMessages((prev) => [...prev, "Failed to copy to clipboard"])
        console.error("Failed to copy:", error)
      }
    } else {
      // Fallback: Create a temporary textarea element
      try {
        const textarea = document.createElement("textarea")
        textarea.value = connectionString
        textarea.style.position = "fixed"
        textarea.style.opacity = "0"
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand("copy")
        document.body.removeChild(textarea)
        setMessages((prev) => [...prev, "Connection string copied to clipboard"])
      } catch (error) {
        setMessages((prev) => [...prev, "Failed to copy to clipboard"])
        console.error("Failed to copy:", error)
      }
    }
  }

  const handleClearMessages = () => {
    setMessages([])
  }

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <div className="flex flex-col items-center justify-start min-h-screen p-4 pt-8">
        <h1 className="text-3xl font-bold mb-8">Join Bridge</h1>

        <div className="mb-8 w-full max-w-[800px]">
          <p className="mb-2 font-medium">Connection String:</p>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                id="connectionString"
                type="text"
                value={connectionString}
                onChange={(e) => setConnectionString(e.target.value)}
                className="w-full p-3 pr-10 border rounded bg-background text-foreground text-sm"
                placeholder="Enter connection string"
              />
              <button
                onClick={handleCopyConnectionString}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition"
                title="Copy to clipboard"
              >
                <CopyIcon />
              </button>
            </div>
            <button
              onClick={() => handleJoinBridge(connectionString)}
              className="px-4 py-3 bg-foreground text-background font-medium rounded hover:bg-foreground/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={joinStatus !== "idle"}
            >
              {joinStatus === "joining" ? "Joining..." : joinStatus === "connected" ? "Connected" : "Join"}
            </button>
            <button
              onClick={handleClearSession}
              className="px-4 py-3 bg-orange-600 text-white font-medium rounded hover:bg-orange-700 transition"
            >
              Clear Session
            </button>
          </div>
        </div>

        <MessagesPanel
          messages={messages}
          onSendMessage={handleSendMessage}
          onClearMessages={handleClearMessages}
          defaultMessage="hello_from_joiner"
        />
      </div>
    </Suspense>
  )
}

export default function JoinBridgePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <JoinBridgeContent />
    </Suspense>
  )
}
