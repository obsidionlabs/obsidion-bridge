"use client"

import { useState, useRef, useEffect } from "react"

interface MessagesPanelProps {
  messages: string[]
  onSendMessage: (message: string) => void
  onClearMessages?: () => void
  defaultMessage?: string
}

export function MessagesPanel({ messages, onSendMessage, onClearMessages, defaultMessage }: MessagesPanelProps) {
  const [messageText, setMessageText] = useState(defaultMessage || "")
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
      {onClearMessages && (
        <div className="flex justify-end mt-1">
          <button
            onClick={onClearMessages}
            className="px-3 py-1 text-sm bg-gray-500 text-white font-medium rounded hover:bg-gray-600 transition"
          >
            Clear
          </button>
        </div>
      )}

      <div className="mt-4 space-y-2">
        <div>
          <label className="block font-medium mb-2">Send Encrypted Message:</label>
          <label htmlFor="message" className="block text-sm font-medium mb-1">
            Method:
          </label>
          <div className="flex gap-2">
            <input
              id="message"
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Method name"
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
