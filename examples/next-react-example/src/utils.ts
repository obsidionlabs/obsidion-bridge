import { bytesToHex, hexToBytes } from "@noble/ciphers/utils"
import { BridgeInterface, KeyPair } from "../../../dist/esm"
import { generateECDHKeyPair } from "../../../dist/esm/encryption"

const saveKeyPair = async (keyPair: KeyPair, role: "creator" | "joiner") => {
  const parsedKeyPair = {
    privateKey: bytesToHex(keyPair.privateKey),
    publicKey: bytesToHex(keyPair.publicKey),
  }

  localStorage.setItem(`keyPair_${role}`, JSON.stringify(parsedKeyPair))
}

const getKeyPair = async (role: "creator" | "joiner") => {
  const keyPair = localStorage.getItem(`keyPair_${role}`)
  if (keyPair) {
    const parsedKeyPair = JSON.parse(keyPair)
    return {
      privateKey: hexToBytes(parsedKeyPair.privateKey),
      publicKey: hexToBytes(parsedKeyPair.publicKey),
    }
  }
  const newKeyPair = await generateECDHKeyPair()
  await saveKeyPair(newKeyPair, role)
  return newKeyPair
}

const saveRemotePublicKey = async (publicKey: string, role: "creator" | "joiner") => {
  localStorage.setItem(`remotePublicKey_${role}`, publicKey)
}

const getRemotePublicKeyFromLS = async (role: "creator" | "joiner") => {
  const remotePublicKey = localStorage.getItem(`remotePublicKey_${role}`)
  if (remotePublicKey) {
    return hexToBytes(remotePublicKey)
  }
  return null
}

type ConnectionState = {
  role: "creator" | "joiner"
  keyPair: KeyPair
  remotePublicKey: string | null
  connected: boolean
}

const getConnectionState = async (role: "creator" | "joiner"): Promise<ConnectionState> => {
  const keyPair = await getKeyPair(role)
  const remotePublicKey = await getRemotePublicKeyFromLS(role)
  if (remotePublicKey) {
    return {
      role,
      keyPair,
      remotePublicKey: bytesToHex(remotePublicKey),
      connected: true,
    }
  }
  return {
    role,
    keyPair,
    remotePublicKey: null,
    connected: false,
  }
}

// todo: store remote pub key in local storage
let refreshed = true
const isRefreshed = () => {
  const result = refreshed
  console.log("isRefreshed", result)
  refreshed = false
  return result
}

export {
  saveKeyPair,
  getKeyPair,
  saveRemotePublicKey,
  getRemotePublicKeyFromLS,
  getConnectionState,
  isRefreshed,
}
