import { KeyPair } from "../../../../dist/esm/encryption"

// Session storage key for bridge session data
const BRIDGE_SESSION_STORAGE_KEY = "obsidion-bridge-session"

/**
 * Save bridge session to session storage
 */
export function saveBridgeSession(keyPair: KeyPair): void {
  try {
    sessionStorage.setItem(
      BRIDGE_SESSION_STORAGE_KEY,
      JSON.stringify({
        publicKey: Array.from(keyPair.publicKey),
        privateKey: Array.from(keyPair.privateKey),
      }),
    )
    console.log("Saved keyPair to sessionStorage")
  } catch (error) {
    console.error("Failed to save keyPair to sessionStorage:", error)
  }
}

/**
 * Restore bridge session from session storage
 */
export function restoreBridgeSession(): KeyPair | undefined {
  try {
    const keyPairJson = sessionStorage.getItem(BRIDGE_SESSION_STORAGE_KEY)
    if (keyPairJson) {
      const parsedSavedKeyPair = JSON.parse(keyPairJson)
      const keyPair = {
        publicKey: new Uint8Array(parsedSavedKeyPair.publicKey),
        privateKey: new Uint8Array(parsedSavedKeyPair.privateKey),
      }
      console.log("Found existing keyPair in sessionStorage")
      return keyPair
    }
  } catch (error) {
    console.error("Failed to retrieve keyPair from sessionStorage:", error)
  }
  return
}

/**
 * Clear bridge session from session storage
 */
export function clearBridgeSession(): void {
  sessionStorage.removeItem(BRIDGE_SESSION_STORAGE_KEY)
}
