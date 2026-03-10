import {
  KOIOS_URL,
  POLICY_ID,
  BRIDGE_SCRIPT_HASH,
  CARDANO_POLL_INTERVAL
} from './config.js'

import {
  registerCardanoEvent,
  registerRegistrationLink
} from './correlator.js'

const seenTxHashes = new Set()

let pollTimer = null

async function fetchPolicyTransactions() {
  try {
    const response = await fetch(`${KOIOS_URL}/asset_txs?_asset_policy=${POLICY_ID}&_after_block_height=0`, {
      headers: { 'Accept': 'application/json' }
    })

    if (!response.ok) return

    const txList = await response.json()

    for (const entry of txList) {
      if (seenTxHashes.has(entry.tx_hash)) continue
      seenTxHashes.add(entry.tx_hash)
      await processTx(entry.tx_hash)
    }
  } catch (error) {
    console.error('Koios poll error:', error)
  }
}

async function processTx(txHash) {
  try {
    const response = await fetch(`${KOIOS_URL}/tx_info`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ _tx_hashes: [txHash] })
    })

    if (!response.ok) return

    const [tx] = await response.json()
    if (!tx) return

    const timestamp = new Date(tx.tx_timestamp * 1000).getTime()

    const nightOutput = tx.outputs?.find(output =>
      output.asset_list?.some(asset => asset.policy_id === POLICY_ID)
    )

    if (!nightOutput) return

    const nightAsset = nightOutput.asset_list.find(asset => asset.policy_id === POLICY_ID)
    const nightAmount = parseInt(nightAsset?.quantity || '0')

    const isBridgeTx = BRIDGE_SCRIPT_HASH && nightOutput.payment_addr?.bech32 === BRIDGE_SCRIPT_HASH

    const registrationLink = extractRegistrationLink(tx)

    if (registrationLink) {
      registerRegistrationLink(
        registrationLink.cardanoAddress,
        registrationLink.midnightAddress,
        timestamp
      )
    }

    registerCardanoEvent(
      nightOutput.payment_addr?.bech32,
      nightAmount,
      timestamp,
      txHash,
      isBridgeTx
    )
  } catch (error) {
    console.error('Tx processing error:', txHash, error)
  }
}

function extractRegistrationLink(tx) {
  if (!tx.metadata) return null

  const registrationMetadata = tx.metadata.find(meta =>
    meta.key === '1984' || meta.key === 'midnight_registration'
  )

  if (!registrationMetadata) return null

  const cardanoAddress = tx.inputs?.[0]?.payment_addr?.bech32
  const midnightAddress = registrationMetadata.json?.midnight_pubkey ||
    registrationMetadata.json?.midnight_address

  if (!cardanoAddress || !midnightAddress) return null

  return { cardanoAddress, midnightAddress }
}

function startCardanoWatcher() {
  fetchPolicyTransactions()
  pollTimer = setInterval(fetchPolicyTransactions, CARDANO_POLL_INTERVAL)
}

function stopCardanoWatcher() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export { startCardanoWatcher, stopCardanoWatcher }
