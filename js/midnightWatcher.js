import {
  MIDNIGHT_RPC_WS,
  MIDNIGHT_WS_RECONNECT_DELAY
} from './config.js'

import { registerMidnightEvent } from './correlator.js'

let socket = null
let reconnectTimer = null
let active = false
let reconnectAttempts = 0

const MAX_RECONNECT_ATTEMPTS = 5

function connect() {
  socket = new WebSocket(MIDNIGHT_RPC_WS)

  socket.onopen = () => {
    reconnectAttempts = 0

    socket.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'state_subscribeStorage',
      params: []
    }))

    socket.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'chain_subscribeNewHeads',
      params: []
    }))
  }

  socket.onmessage = (message) => {
    try {
      const data = JSON.parse(message.data)
      handleRpcMessage(data)
    } catch (error) {
      console.error('Midnight RPC parse error:', error)
    }
  }

  socket.onerror = (error) => {
    console.error('Midnight WS error:', error)
  }

  socket.onclose = () => {
    if (active && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++
      reconnectTimer = setTimeout(connect, MIDNIGHT_WS_RECONNECT_DELAY * reconnectAttempts)
    }
  }
}

function handleRpcMessage(data) {
  if (!data.method && !data.params) return

  const payload = data.params?.result

  if (!payload) return

  if (data.method === 'state_storage') {
    processStorageChange(payload)
    return
  }

  if (data.method === 'chain_newHead') {
    processNewHead(payload)
  }
}

function processStorageChange(payload) {
  const changes = payload.changes || []

  for (const [key, value] of changes) {
    if (!value) continue

    const isDustBurn = key.includes('dust') || key.includes('burn') || key.includes('shield')

    if (!isDustBurn) continue

    const midnightAddress = extractMidnightAddress(key)
    const dustAmount = extractDustAmount(value)
    const timestamp = Date.now()

    if (midnightAddress && dustAmount > 0) {
      registerMidnightEvent(midnightAddress, dustAmount, timestamp, 'burn')
    }
  }
}

function processNewHead(payload) {
  const blockNumber = parseInt(payload.number, 16)
  const timestamp = Date.now()

  dispatchEvent(new CustomEvent('midnightBlock', {
    detail: { blockNumber, timestamp }
  }))
}

function extractMidnightAddress(storageKey) {
  if (!storageKey || storageKey.length < 32) return null
  return storageKey.slice(-64)
}

function extractDustAmount(storageValue) {
  if (!storageValue) return 0
  try {
    const hex = storageValue.replace('0x', '')
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)))
    const view = new DataView(bytes.buffer)
    return view.getBigUint64(0, true)
  } catch {
    return 0
  }
}

function startMidnightWatcher() {
  active = true
  connect()
}

function stopMidnightWatcher() {
  active = false
  reconnectAttempts = 0
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (socket) {
    socket.close()
    socket = null
  }
}

export { startMidnightWatcher, stopMidnightWatcher }
