"use client"
import { useEffect, useState } from "react"
// import { Bridge, BridgeInterface } from "@obsidion/bridge"
import { Bridge, BridgeInterface } from "../../../../../src/bridge"
import { BridgeDisconnectedEvent, FailedToConnectEvent } from "../../../../../src/types"
import { MessagesPanel } from "../components/MessagesPanel"
import { CopyIcon } from "../components/CopyIcon"
import debug from "debug"
import { restoreBridgeSession, saveBridgeSession, clearBridgeSession } from "@/lib/session"
import { hexToBytes } from "@noble/ciphers/utils"

const WS_READY_STATE: Record<number, string> = { 0: "CONNECTING", 1: "OPEN", 2: "CLOSING", 3: "CLOSED" }

debug.enable("bridge*")

let runningTimerLastTime: number | null = null

export default function CreateBridgePage() {
  const [bridge, setBridge] = useState<BridgeInterface | null>(null)
  const [connectionString, setConnectionString] = useState<string>("")
  const [messages, setMessages] = useState<string[]>([])
  const [hasSession, setHasSession] = useState<boolean>(false)

  function logMessage(message: string) {
    setMessages((prev) => [...prev, message])
    console.log(message)
  }

  useEffect(() => {
    const runningTimer = setInterval(() => {
      if (runningTimerLastTime) {
        const secondsAgo = Date.now() - runningTimerLastTime
        if (secondsAgo > 2000) {
          logMessage(`Timer last ran ${secondsAgo}ms ago, focus has probably returned`)
        }
      }
      runningTimerLastTime = Date.now()
    }, 1000)
    return () => clearInterval(runningTimer)
  }, [])

  useEffect(() => {
    const createBridge = async () => {
      // Resume bridge session if available
      const savedBridgeSession = restoreBridgeSession()
      const resume = savedBridgeSession?.remotePublicKey ? true : false
      setHasSession(resume)
      if (resume) {
        logMessage("Resuming bridge session")
      }

      // Create bridge (and resume using saved bridge session if available)
      const bridge = await Bridge.create({
        bridgeUrl: "wss://bridge-staging.zkpassport.id",
        keyPair: savedBridgeSession?.keyPair,
        remotePublicKey: savedBridgeSession?.remotePublicKey,
        resume,
      })

      setBridge(bridge)
      setConnectionString(bridge.connectionString)
      console.log("Bridge created. Connection string:", bridge.connectionString)

      bridge.onSecureChannelEstablished(() => {
        logMessage("Secure channel established")
        logMessage(`Remote public key: ${bridge.getRemotePublicKey()}`)
        logMessage(`Local public key: ${bridge.getPublicKey()}`)
        // Save bridge session data for resuming
        saveBridgeSession(bridge.getKeyPair(), hexToBytes(bridge.getRemotePublicKey()))
        setHasSession(true)
      })

      bridge.onRawMessage((message: unknown) => {
        logMessage(`Raw message received: ${message}`)
      })

      bridge.onSecureMessage((message: unknown) => {
        logMessage(`Message received: ${JSON.stringify(message)}`)
      })

      bridge.onConnect((reconnection: boolean) => {
        logMessage(`Connected to bridge${reconnection ? " (reconnected)" : ""}`)
      })

      bridge.onFailedToConnect((event: FailedToConnectEvent) => {
        const readyStateStr = WS_READY_STATE[bridge.websocket!.readyState]
        logMessage(`Failed to connect to bridge: ${event.code} "${event.reason}"`)
        logMessage(`websocket.readyState: ${readyStateStr}`)
      })

      bridge.onDisconnect((event: BridgeDisconnectedEvent) => {
        const readyStateStr = WS_READY_STATE[bridge.websocket!.readyState]
        logMessage(`Disconnected from bridge: ${event.event.code} "${event.event.reason}" ${event.event.wasClean}`)
        logMessage(
          `wasConnected: ${event.wasConnected}, wasClean: ${event.event.wasClean}, wasIntentionalClose: ${event.wasIntentionalClose}, willReconnect: ${event.willReconnect}`
        )
        logMessage(`websocket.readyState: ${readyStateStr}`)
        console.log("Disconnected from bridge:", event)
      })

      bridge.onError((error: string) => {
        logMessage(`Error: ${error}`)
      })
    }
    createBridge()
  }, [])

  const handleJoin = () => {
    window.open(`/join?uri=${encodeURIComponent(connectionString)}`, "_blank")
  }

  const handleSendMessage = async (method: string) => {
    if (bridge && bridge.isBridgeConnected()) {
      if (await bridge.sendMessage(method, {})) {
        logMessage(`Sent: ${method}`)
      } else {
        logMessage("Failed to send message")
      }
    } else {
      logMessage("Cannot send message: Bridge not connected")
    }
  }

  const handleClose = () => {
    bridge?.close()
    setMessages((prev) => [...prev, "Bridge closed"])
  }

  const handleClearSession = () => {
    clearBridgeSession()
    setHasSession(false)
    setMessages((prev) => [...prev, "Session cleared from storage"])
    bridge?.cleanup()
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
    <div className="flex flex-col items-center justify-start min-h-screen p-4 pt-8">
      <h1 className="text-3xl font-bold mb-8">Create Bridge</h1>
      {connectionString && (
        <div className="mb-8 w-full max-w-[800px]">
          <p className="mb-2 font-medium">Connection String:</p>
          <div className="flex flex-col md:flex-row gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={connectionString}
                readOnly
                className="w-full p-3 pr-10 border rounded bg-background text-foreground text-sm"
              />
              <button
                onClick={handleCopyConnectionString}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition"
                title="Copy to clipboard"
              >
                <CopyIcon />
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleJoin}
                className="flex-1 md:flex-none px-4 py-3 bg-foreground text-background font-medium rounded hover:bg-foreground/90 transition"
              >
                Open in Join Page
              </button>
              <button
                onClick={handleClose}
                className="flex-1 md:flex-none px-4 py-3 bg-red-600 text-white font-medium rounded hover:bg-red-700 transition"
              >
                Close
              </button>
              <button
                onClick={handleClearSession}
                disabled={!hasSession}
                className="flex-1 md:flex-none px-4 py-3 bg-orange-600 text-white font-medium rounded hover:bg-orange-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear Session
              </button>
            </div>
          </div>
        </div>
      )}

      <MessagesPanel
        messages={messages}
        onSendMessage={handleSendMessage}
        onClearMessages={handleClearMessages}
        defaultMessage="hello_from_creator"
      />
    </div>
  )
}
