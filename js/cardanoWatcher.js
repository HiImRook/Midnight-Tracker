import {
  BLOCKFROST_URL,
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
let blockfrostKey = null

function setBlockfrostKey(key) {
  blockfrostKey = key
}

function blockfrostHeaders() {
  return {
    'Accept': 'application/json',
    'project_id': blockfrostKey
  }
}

async function fetchPolicyTransactions() {
  if (!blockfrostKey) return

  try {
    const response = await fetch(
      `${BLOCKFROST_URL}/assets/policy/${POLICY_ID}/transactions?count=100&order=desc`,
      { headers: blockfrostHeaders() }
    )

    if (!response.ok) return

    const txList = await response.json()

    for (const entry of txList) {
      if (seenTxHashes.has(entry.tx_hash)) continue
      seenTxHashes.add(entry.tx_hash)
      await processTx(entry.tx_hash)
    }
  } catch (error) {
    console.error('Blockfrost poll error:', error)
  }
}

async function processTx(txHash) {
  if (!blockfrostKey) return

  try {
    const response = await fetch(
      `${BLOCKFROST_URL}/txs/${txHash}/utxos`,
      { headers: blockfrostHeaders() }
    )

    if (!response.ok) return

    const tx = await response.json()
    if (!tx) return

    const detailResponse = await fetch(
      `${BLOCKFROST_URL}/txs/${txHash}`,
      { headers: blockfrostHeaders() }
    )

    if (!detailResponse.ok) return

    const txDetail = await detailResponse.json()
    const timestamp = txDetail.block_time * 1000

    const nightOutput = tx.outputs?.find(output =>
      output.amount?.some(a => a.unit?.startsWith(POLICY_ID))
    )

    if (!nightOutput) return

    const nightAsset = nightOutput.amount.find(a => a.unit?.startsWith(POLICY_ID))
    const nightAmount = parseInt(nightAsset?.quantity || '0')
    const isBridgeTx = BRIDGE_SCRIPT_HASH && nightOutput.address === BRIDGE_SCRIPT_HASH

    const registrationLink = await extractRegistrationLink(txHash, tx)

    if (registrationLink) {
      registerRegistrationLink(
        registrationLink.cardanoAddress,
        registrationLink.midnightAddress,
        timestamp
      )
    }

    registerCardanoEvent(
      nightOutput.address,
      nightAmount,
      timestamp,
      txHash,
      isBridgeTx
    )
  } catch (error) {
    console.error('Tx processing error:', txHash, error)
  }
}

async function extractRegistrationLink(txHash, tx) {
  if (!blockfrostKey) return null

  try {
    const response = await fetch(
      `${BLOCKFROST_URL}/txs/${txHash}/metadata`,
      { headers: blockfrostHeaders() }
    )

    if (!response.ok) return null

    const metadata = await response.json()
    if (!metadata?.length) return null

    const registrationMetadata = metadata.find(meta =>
      meta.label === '1984' || meta.label === 'midnight_registration'
    )

    if (!registrationMetadata) return null

    const cardanoAddress = tx.inputs?.[0]?.address
    const midnightAddress = registrationMetadata.json_metadata?.midnight_pubkey ||
      registrationMetadata.json_metadata?.midnight_address

    if (!cardanoAddress || !midnightAddress) return null

    return { cardanoAddress, midnightAddress }
  } catch (error) {
    return null
  }
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

export { startCardanoWatcher, stopCardanoWatcher, setBlockfrostKey }
