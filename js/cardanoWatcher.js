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
const seenTxQueue = []
const MAX_SEEN_TX = 5000

function rememberTxHash(txHash) {
  if (seenTxHashes.has(txHash)) return false
  seenTxHashes.add(txHash)
  seenTxQueue.push(txHash)
  if (seenTxQueue.length > MAX_SEEN_TX) {
    const oldest = seenTxQueue.shift()
    if (oldest) seenTxHashes.delete(oldest)
  }
  return true
}

const cachedAssetUnits = new Set()

let pollTimer = null
let blockfrostKey = null
let assetCacheTimestamp = 0

const ASSET_CACHE_TTL = 30 * 60 * 1000
const ASSET_TX_PAGE_SIZE = 100
const ASSET_TX_SCAN_CONCURRENCY = 4

function setBlockfrostKey(key) {
  blockfrostKey = key
}

function blockfrostHeaders() {
  return {
    'Accept': 'application/json',
    'project_id': blockfrostKey
  }
}

function withPage(url, page) {
  const join = url.includes('?') ? '&' : '?'
  return `${url}${join}page=${page}`
}

async function fetchAllPages(baseUrl) {
  const results = []
  let page = 1

  while (true) {
    const response = await fetch(withPage(baseUrl, page), { headers: blockfrostHeaders() })

    if (!response.ok) {
      console.error('Blockfrost fetch error:', response.status, baseUrl)
      break
    }

    const data = await response.json()
    if (!Array.isArray(data) || data.length === 0) break

    results.push(...data)
    if (data.length < 100) break
    page++
  }

  return results
}

async function refreshAssetUnits() {
  const now = Date.now()
  if (now - assetCacheTimestamp < ASSET_CACHE_TTL && cachedAssetUnits.size > 0) return
  if (!blockfrostKey) return

  try {
    const assets = await fetchAllPages(
      `${BLOCKFROST_URL}/assets/policy/${POLICY_ID}?count=100&order=desc`
    )

    cachedAssetUnits.clear()
    for (const asset of assets) {
      if (asset?.asset) cachedAssetUnits.add(asset.asset)
    }

    assetCacheTimestamp = now
    console.log(`Refreshed policy assets: ${cachedAssetUnits.size}`)
  } catch (error) {
    console.error('Asset unit refresh error:', error)
  }
}

async function fetchPolicyTransactions() {
  if (!blockfrostKey) return

  await refreshAssetUnits()

  const units = [...cachedAssetUnits]
  if (units.length === 0) return

  for (let i = 0; i < units.length; i += ASSET_TX_SCAN_CONCURRENCY) {
    const batch = units.slice(i, i + ASSET_TX_SCAN_CONCURRENCY)
    await Promise.all(batch.map((u) => fetchAssetTransactionsPage1(u)))
  }
}

async function fetchAssetTransactionsPage1(assetUnit) {
  try {
    const url = `${BLOCKFROST_URL}/assets/${assetUnit}/transactions?count=${ASSET_TX_PAGE_SIZE}&order=desc`
    const response = await fetch(url, { headers: blockfrostHeaders() })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error('Asset tx fetch error:', assetUnit, response.status, body)
      return
    }

    const txList = await response.json()
    if (!Array.isArray(txList) || txList.length === 0) return

    for (const entry of txList) {
      const txHash = entry?.tx_hash
      if (!txHash) continue
      if (seenTxHashes.has(txHash)) break
      if (!rememberTxHash(txHash)) continue
      await processTx(txHash)
    }
  } catch (error) {
    console.error('Asset tx fetch error:', assetUnit, error)
  }
}

async function processTx(txHash) {
  if (!blockfrostKey) return

  try {
    const utxoResponse = await fetch(
      `${BLOCKFROST_URL}/txs/${txHash}/utxos`,
      { headers: blockfrostHeaders() }
    )

    if (!utxoResponse.ok) {
      console.error('UTXO fetch error:', utxoResponse.status, txHash)
      return
    }

    const tx = await utxoResponse.json()

    const detailResponse = await fetch(
      `${BLOCKFROST_URL}/txs/${txHash}`,
      { headers: blockfrostHeaders() }
    )

    if (!detailResponse.ok) {
      console.error('Tx detail fetch error:', detailResponse.status, txHash)
      return
    }

    const txDetail = await detailResponse.json()
    const timestamp = txDetail.block_time * 1000

    const matchingOutputs = tx.outputs?.filter(output =>
      output.amount?.some(a => a.unit?.startsWith(POLICY_ID))
    ) || []

    for (const output of matchingOutputs) {
      const policyAssets = output.amount.filter(a => a.unit?.startsWith(POLICY_ID))

      for (const asset of policyAssets) {
        const amount = parseInt(asset.quantity || '0')
        registerCardanoEvent(
          output.address,
          amount,
          timestamp,
          txHash
        )
      }
    }

    const registrationLink = await extractRegistrationLink(txHash, tx)
    if (registrationLink) {
      registerRegistrationLink(
        registrationLink.cardanoAddress,
        registrationLink.midnightAddress,
        timestamp
      )
    }
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
  } catch {
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
