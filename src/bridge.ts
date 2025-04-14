import { bytesToHex } from "@noble/ciphers/utils"
import { BridgeConnection } from "./bridge-connection"
import { generateECDHKeyPair, KeyPair } from "./encryption"
import { WebSocketClient } from "./websocket"
import debug from "debug"

/**
 * Options for creating a bridge
 */
export interface CreateOptions {
  origin?: string
  bridgeId?: string
  keyPair?: KeyPair
  resume?: boolean
  remotePublicKey?: Uint8Array
  autoconnect?: boolean
  reconnect?: boolean
  keepalive?: boolean
  debug?: boolean
  pingInterval?: number
}

/**
 * Options for joining a bridge
 */
export interface JoinOptions {
  keyPair?: KeyPair
  resume?: boolean
  reconnect?: boolean
  keepalive?: boolean
  debug?: boolean
  pingInterval?: number
}

/**
 * Functional bridge interface returned by create() and join()
 */
export interface BridgeInterface {
  websocket: WebSocketClient | undefined
  connection: BridgeConnection
  onConnect: (callback: (reconnection: boolean) => void) => () => void
  onSecureChannelEstablished: (callback: () => void) => () => void
  onSecureMessage: (callback: (message: any) => void) => () => void
  onError: (callback: (error: string) => void) => () => void
  onDisconnect: (callback: () => void) => () => void
  isBridgeConnected: () => boolean
  isSecureChannelEstablished: () => boolean
  sendMessage: (method: string, params?: any) => Promise<boolean>
  connectionString: string
  origin: string
  getPublicKey: () => string
  getRemotePublicKey: () => string
  getKeyPair: () => KeyPair
  close: () => void
}

/**
 * Main Bridge class - provides static methods for creating and joining bridges
 */
export class Bridge {
  /**
   * Create a new bridge connection as the creator
   * @param options Options for creating a bridge
   * @returns A promise that resolves to a functional bridge interface
   */
  public static async create(options: CreateOptions = {}): Promise<BridgeInterface> {
    // Enable debug mode if requested
    if (options.debug) debug.enable("bridge*")

    // Set autoconnect default to true
    const autoconnect = options.autoconnect ?? true

    // Get origin
    if (options.origin && typeof window !== "undefined") {
      throw new Error("Origin can't be specified when running in browser")
    }
    if (!options.origin && typeof window === "undefined") {
      options.origin = "nodejs"
    }
    const origin = options.origin || window?.location?.protocol + "//" + window?.location?.hostname

    // Handle arguments for resuming an existing bridge session
    if (options.remotePublicKey && !options.resume) {
      throw new Error("Can only provide remotePublicKey when resuming a bridge session")
    }
    if (options.resume && (!options.keyPair || !options.remotePublicKey)) {
      throw new Error("Resuming a bridge session requires a keyPair and remotePublicKey")
    }

    // Use provided key pair or generate a new one
    const keyPair = options.keyPair || (await generateECDHKeyPair())

    // Use creator's public key as the bridge ID
    const bridgeId = bytesToHex(keyPair.publicKey)

    // Create connection instance with creator role
    const connection = new BridgeConnection({
      role: "creator",
      origin,
      bridgeId,
      keyPair,
      reconnect: options.reconnect,
      keepalive: options.keepalive,
      pingInterval: options.pingInterval,
    })

    // Resume existing bridge session if requested
    if (options.resume) {
      // Set remote public key
      connection.setRemotePublicKey(options.remotePublicKey!)
      // Compute shared secret
      await connection.computeSharedSecret()
      connection.resume()
    }

    // Connect to the bridge service if autoconnect option is true (default behaviour)
    if (options.resume || autoconnect) {
      await connection.connect(await connection._getWsConnectionUrl())
    }

    // Return functional interface
    return {
      websocket: connection.getWebSocket(),
      connection: connection,
      onConnect: (callback) => connection.onConnect(callback),
      onSecureChannelEstablished: (callback) => connection.onSecureChannelEstablished(callback),
      onSecureMessage: (callback) => connection.onSecureMessage(callback),
      onError: (callback) => connection.onError(callback),
      onDisconnect: (callback) => connection.onDisconnect(callback),
      isBridgeConnected: () => connection.isBridgeConnected(),
      isSecureChannelEstablished: () => connection.isSecureChannelEstablished(),
      sendMessage: (method, params) => connection.sendSecureMessage(method, params || {}),
      connectionString: connection.connectionString!,
      origin: connection.bridgeOrigin,
      getKeyPair: () => connection.keyPair,
      getPublicKey: () => connection.getPublicKey(),
      getRemotePublicKey: () => connection.getRemotePublicKey(),
      close: () => connection.close(),
    }
  }

  /**
   * Join an existing bridge connection as the joiner
   * @param uri The connection string from the creator
   * @param options Options for joining a bridge
   * @returns A promise that resolves to a functional bridge interface
   */
  public static async join(uri: string, options: JoinOptions = {}): Promise<BridgeInterface> {
    // Enable debug mode if requested
    if (options.debug) {
      debug.enable("bridge*")
    }

    // Handle arguments for resuming an existing bridge session
    if (options.resume && !options.keyPair) {
      throw new Error("Resuming a bridge session requires a keyPair")
    }

    // Use provided key pair or generate a new one
    const keyPair = options.keyPair || (await generateECDHKeyPair())

    // Parse URL parameters
    const { domain, pubkey } = Bridge.parseConnectionString(uri)

    // Create connection instance with joiner role and domain
    const connection = new BridgeConnection({
      role: "joiner",
      domain: domain,
      bridgeId: pubkey,
      keyPair,
      reconnect: options.reconnect,
      keepalive: options.keepalive,
      pingInterval: options.pingInterval,
    })

    // Set remote public key
    connection.setRemotePublicKey(new Uint8Array(Buffer.from(pubkey, "hex")))

    // Compute shared secret
    await connection.computeSharedSecret()

    // Resume existing bridge session if requested
    if (options.resume) connection.resume()

    // Connect to the bridge service
    await connection.connect(await connection._getWsConnectionUrl())

    // Return functional interface
    return {
      websocket: connection.getWebSocket(),
      connection: connection,
      onConnect: (callback) => connection.onConnect(callback),
      onSecureChannelEstablished: (callback) => connection.onSecureChannelEstablished(callback),
      onSecureMessage: (callback) => connection.onSecureMessage(callback),
      onError: (callback) => connection.onError(callback),
      onDisconnect: (callback) => connection.onDisconnect(callback),
      isBridgeConnected: () => connection.isBridgeConnected(),
      isSecureChannelEstablished: () => connection.isSecureChannelEstablished(),
      sendMessage: (method, params) => connection.sendSecureMessage(method, params || {}),
      connectionString: connection.connectionString!,
      origin: connection.bridgeOrigin,
      getKeyPair: () => connection.keyPair,
      getPublicKey: () => connection.getPublicKey(),
      getRemotePublicKey: () => connection.getRemotePublicKey(),
      close: () => connection.close(),
    }
  }

  private static parseConnectionString(uri: string): {
    domain: string
    pubkey: string
  } {
    const parsedUri = new URL(uri)
    const pubkey = parsedUri.pathname
    let domain = parsedUri.searchParams.get("d")
    if (!domain || !pubkey) {
      throw new Error("Invalid connection string: missing required parameters")
    }
    // Default to https if no protocol is specified
    if (domain !== "nodejs" && !domain.startsWith("http")) domain = "https://" + domain
    return { domain, pubkey }
  }
}
