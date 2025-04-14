"use client"
import { useEffect, useState } from "react"
// import { Bridge, BridgeInterface } from "@obsidion/bridge"
import { Bridge, BridgeInterface } from "../../../../.."
import { MessagesPanel } from "../components/MessagesPanel"
import debug from "debug"
import { restoreBridgeSession, saveBridgeSession } from "@/lib/session"
import { hexToBytes } from "@noble/ciphers/utils"

debug.enable("bridge*")

export default function CreateBridgePage() {
  const [bridge, setBridge] = useState<BridgeInterface | null>(null)
  const [connectionString, setConnectionString] = useState<string>("")
  const [messages, setMessages] = useState<string[]>([])

  useEffect(() => {
    return () => {
      console.log("Component unmounted, closing bridge")
      bridge?.close()
    }
  }, [bridge])

  useEffect(() => {
    const createBridge = async () => {
      // Restore bridge session if available
      const savedBridgeSession = restoreBridgeSession()
      // Create bridge (and resume using saved bridge session if available)
      const bridge = await Bridge.create({
        keyPair: savedBridgeSession?.keyPair,
        remotePublicKey: savedBridgeSession?.remotePublicKey,
        resume: !!savedBridgeSession,
      })
      setBridge(bridge)
      setConnectionString(bridge.connectionString)
      console.log("Bridge created. Connection string:", bridge.connectionString)

      bridge.onSecureChannelEstablished(() => {
        setMessages((prev) => [
          ...prev,
          "Secure channel established",
          `Remote public key: ${bridge.getRemotePublicKey()}`,
          `Local public key: ${bridge.getPublicKey()}`,
        ])
        // Save bridge session data for resuming
        saveBridgeSession(bridge.getKeyPair(), hexToBytes(bridge.getRemotePublicKey()))
      })

      // Listen for messages
      bridge.onSecureMessage((message) => {
        setMessages((prev) => [...prev, `Received: ${JSON.stringify(message)}`])
        console.log("Message received:", message)
      })

      // Listen for connection events
      bridge.onConnect(() => {
        setMessages((prev) => [...prev, "Connected to bridge"])
      })

      bridge.onDisconnect(() => {
        setMessages((prev) => [...prev, "Disconnected from bridge"])
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

  const handleSendMessage = async (message: string) => {
    if (bridge && bridge.isBridgeConnected()) {
      if (await bridge.sendMessage(message)) {
        setMessages((prev) => [...prev, `Sent: ${message}`])
      }
    } else {
      setMessages((prev) => [...prev, "Cannot send message: Bridge not connected"])
    }
  }

  return (
    <div className="flex flex-col items-center justify-start min-h-screen p-4 pt-8">
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
