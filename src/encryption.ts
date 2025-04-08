import { gcm } from "@noble/ciphers/aes"
import { utf8ToBytes } from "@noble/ciphers/utils"
import { getPublicKey, utils, getSharedSecret as getSharedSecretSecp256k1 } from "@noble/secp256k1"

/**
 * Key pair for ECDH key exchange
 */
export interface KeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

async function sha256Truncate(topic: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(topic)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const fullHashArray = new Uint8Array(hashBuffer)
  const truncatedHashArray = fullHashArray.slice(0, 12)
  return truncatedHashArray
}

export async function generateECDHKeyPair() {
  const privKey = utils.randomPrivateKey()
  const pubKey = getPublicKey(privKey)
  return {
    privateKey: privKey,
    publicKey: pubKey,
  }
}

export async function getSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array) {
  const sharedSecret = getSharedSecretSecp256k1(privateKey, publicKey)
  return sharedSecret.slice(0, 32)
}

export async function encrypt(message: string, sharedSecret: Uint8Array, nonce: string) {
  // Nonce must be 12 bytes
  const nonceBytes = await sha256Truncate(nonce)
  const aes = gcm(sharedSecret, nonceBytes)
  const data = utf8ToBytes(message)
  const ciphertext = aes.encrypt(data)
  return ciphertext
}

export async function decrypt(ciphertext: Uint8Array, sharedSecret: Uint8Array, nonce: string) {
  // Nonce must be 12 bytes, so we use a truncated SHA-256 hash of the nonce input
  const nonceBytes = await sha256Truncate(nonce)
  const aes = gcm(sharedSecret, nonceBytes)
  const data = aes.decrypt(ciphertext)
  const dataString = new TextDecoder().decode(data)
  return dataString
}
