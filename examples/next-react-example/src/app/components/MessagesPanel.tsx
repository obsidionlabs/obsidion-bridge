"use client"

import { useState, useRef, useEffect } from "react"

interface MessagesPanelProps {
  messages: string[]
  onSendMessage: (message: string) => void
  defaultMessage?: string
}

export function MessagesPanel({ messages, onSendMessage, defaultMessage }: MessagesPanelProps) {
  const [messageText, setMessageText] = useState(defaultMessage || "hello")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to the bottom when messages change
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="w-full max-w-[800px] mb-8">
      <p className="mb-2 font-medium">Messages:</p>
      <textarea
        ref={textareaRef}
        readOnly
        value={messages.join("\n")}
        className="w-full h-[200px] p-3 border rounded bg-background text-foreground font-mono text-sm"
      />

      <div className="mt-4 space-y-2">
        <div>
          <label htmlFor="message" className="block font-medium mb-2">
            Send Message:
          </label>
          <div className="flex gap-2">
            <input
              id="message"
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              className="flex-1 p-2 border rounded"
            />
            <button
              onClick={() => onSendMessage(messageText)}
              className="px-4 py-2 bg-foreground text-background font-medium rounded hover:bg-foreground/90 transition"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
