import { KeyPair } from "../../../../dist/esm/encryption"

// Session storage key for bridge session data
const BRIDGE_SESSION_STORAGE_KEY = "obsidion-bridge-session"

/**
 * Save bridge session to session storage
 */
export function saveBridgeSession(keyPair: KeyPair, remotePublicKey?: Uint8Array): void {
  try {
    sessionStorage.setItem(
      BRIDGE_SESSION_STORAGE_KEY,
      JSON.stringify({
        publicKey: Array.from(keyPair.publicKey),
        privateKey: Array.from(keyPair.privateKey),
        ...(remotePublicKey ? { remotePublicKey: Array.from(remotePublicKey) } : {}),
      }),
    )
    console.log("Saved bridge session to session storage")
  } catch (error) {
    console.error("Failed to save bridge session to session storage:", error)
  }
}

/**
 * Restore bridge session from session storage
 */
export function restoreBridgeSession():
  | { keyPair: KeyPair; remotePublicKey?: Uint8Array }
  | undefined {
  try {
    const keyPairJson = sessionStorage.getItem(BRIDGE_SESSION_STORAGE_KEY)
    if (keyPairJson) {
      const parsedSavedKeyPair = JSON.parse(keyPairJson)
      const keyPair = {
        publicKey: new Uint8Array(parsedSavedKeyPair.publicKey),
        privateKey: new Uint8Array(parsedSavedKeyPair.privateKey),
      }
      console.log("Found existing bridge session in session storage")
      return {
        keyPair,
        ...(parsedSavedKeyPair.remotePublicKey
          ? { remotePublicKey: new Uint8Array(parsedSavedKeyPair.remotePublicKey) }
          : {}),
      }
    }
  } catch (error) {
    console.error("Failed to retrieve bridge session from session storage:", error)
  }
  return
}

/**
 * Clear bridge session from session storage
 */
export function clearBridgeSession(): void {
  sessionStorage.removeItem(BRIDGE_SESSION_STORAGE_KEY)
  console.log("Cleared bridge session from session storage")
}
