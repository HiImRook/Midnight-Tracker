import {
  VECTOR_WEIGHTS,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  CONFIDENCE_LOW,
  DUST_GROWTH_RATE,
  DUST_CAP_FACTOR,
  DUST_DECAY_RATE,
  TIMING_WINDOW_MS
} from './config.js'

const cardanoProfiles = new Map()
const midnightProfiles = new Map()
const correlations = new Map()

const events = new EventTarget()

function registerCardanoEvent(cardanoAddress, nightAmount, timestamp, txHash) {
  const existing = cardanoProfiles.get(cardanoAddress) || {
    nightAmount: 0,
    firstSeen: timestamp,
    lastSeen: timestamp,
    txHashes: [],
    linkedMidnightAddress: null,
    registrationTimestamp: null
  }

  existing.nightAmount = nightAmount
  existing.lastSeen = timestamp
  existing.txHashes.push(txHash)

  cardanoProfiles.set(cardanoAddress, existing)
  runCorrelation(cardanoAddress)
}

function registerMidnightEvent(midnightAddress, dustAmount, timestamp, burnType) {
  const existing = midnightProfiles.get(midnightAddress) || {
    dustBurns: [],
    firstSeen: timestamp,
    lastSeen: timestamp,
    linkedCardanoAddress: null
  }

  existing.dustBurns.push({ dustAmount, timestamp, burnType })
  existing.lastSeen = timestamp

  midnightProfiles.set(midnightAddress, existing)
  runCorrelation(null, midnightAddress)
}

function registerRegistrationLink(cardanoAddress, midnightAddress, timestamp) {
  const cardanoProfile = cardanoProfiles.get(cardanoAddress) || {
    nightAmount: 0,
    firstSeen: timestamp,
    lastSeen: timestamp,
    txHashes: [],
    linkedMidnightAddress: null,
    registrationTimestamp: null
  }

  cardanoProfile.linkedMidnightAddress = midnightAddress
  cardanoProfile.registrationTimestamp = timestamp
  cardanoProfiles.set(cardanoAddress, cardanoProfile)

  const midnightProfile = midnightProfiles.get(midnightAddress) || {
    dustBurns: [],
    firstSeen: timestamp,
    lastSeen: timestamp,
    linkedCardanoAddress: null
  }

  midnightProfile.linkedCardanoAddress = cardanoAddress
  midnightProfiles.set(midnightAddress, midnightProfile)

  runCorrelation(cardanoAddress, midnightAddress)
}

function calculateExpectedDust(nightAmount, elapsedMs) {
  const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000)
  const cap = nightAmount * DUST_CAP_FACTOR
  return cap * (1 - Math.exp(-DUST_GROWTH_RATE * elapsedDays))
}

function scoreRegistrationLink(cardanoProfile, midnightAddress) {
  if (cardanoProfile.linkedMidnightAddress === midnightAddress) {
    return VECTOR_WEIGHTS.registrationLink
  }
  return 0
}

function scoreTimingMatch(cardanoProfile, midnightProfile) {
  if (!cardanoProfile.registrationTimestamp || midnightProfile.dustBurns.length === 0) {
    return 0
  }

  const firstBurn = midnightProfile.dustBurns[0].timestamp
  const delta = firstBurn - cardanoProfile.registrationTimestamp

  if (delta >= 0 && delta <= TIMING_WINDOW_MS) {
    return VECTOR_WEIGHTS.timingMatch * (1 - delta / TIMING_WINDOW_MS)
  }
  return 0
}

function scoreAmountMatch(cardanoProfile, midnightProfile) {
  if (cardanoProfile.nightAmount === 0 || midnightProfile.dustBurns.length === 0) {
    return 0
  }

  const totalBurned = midnightProfile.dustBurns.reduce((sum, burn) => sum + burn.dustAmount, 0)
  const elapsedMs = midnightProfile.lastSeen - (cardanoProfile.registrationTimestamp || cardanoProfile.firstSeen)
  const expectedDust = calculateExpectedDust(cardanoProfile.nightAmount, elapsedMs)

  if (expectedDust === 0) return 0

  const delta = Math.abs(totalBurned - expectedDust) / expectedDust

  if (delta <= 0.10) return VECTOR_WEIGHTS.amountMatch
  if (delta <= 0.25) return VECTOR_WEIGHTS.amountMatch * 0.5
  return 0
}

function scorePatternMatch(midnightProfile) {
  if (midnightProfile.dustBurns.length < 3) return 0

  const intervals = []
  for (let i = 1; i < midnightProfile.dustBurns.length; i++) {
    intervals.push(midnightProfile.dustBurns[i].timestamp - midnightProfile.dustBurns[i - 1].timestamp)
  }

  const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length
  const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length
  const stdDev = Math.sqrt(variance)
  const coefficientOfVariation = stdDev / avgInterval

  if (coefficientOfVariation < 0.2) return VECTOR_WEIGHTS.patternMatch
  if (coefficientOfVariation < 0.5) return VECTOR_WEIGHTS.patternMatch * 0.5
  return 0
}

function confidenceLabel(score) {
  if (score >= CONFIDENCE_HIGH) return 'HIGH'
  if (score >= CONFIDENCE_MEDIUM) return 'MEDIUM'
  if (score >= CONFIDENCE_LOW) return 'LOW'
  return 'NONE'
}

function runCorrelation(cardanoAddress, midnightAddress) {
  const cardanoTargets = cardanoAddress ? [cardanoAddress] : [...cardanoProfiles.keys()]
  const midnightTargets = midnightAddress ? [midnightAddress] : [...midnightProfiles.keys()]

  for (const cAddr of cardanoTargets) {
    const cardanoProfile = cardanoProfiles.get(cAddr)
    if (!cardanoProfile) continue

    for (const mAddr of midnightTargets) {
      const midnightProfile = midnightProfiles.get(mAddr)
      if (!midnightProfile) continue

      const score =
        scoreRegistrationLink(cardanoProfile, mAddr) +
        scoreTimingMatch(cardanoProfile, midnightProfile) +
        scoreAmountMatch(cardanoProfile, midnightProfile) +
        scorePatternMatch(midnightProfile)

      const correlationKey = `${cAddr}::${mAddr}`
      const existing = correlations.get(correlationKey)

      if (!existing || existing.score !== score) {
        const correlation = {
          cardanoAddress: cAddr,
          midnightAddress: mAddr,
          score: Math.min(score, 1.0),
          label: confidenceLabel(score),
          vectors: {
            registrationLink: scoreRegistrationLink(cardanoProfile, mAddr),
            timingMatch: scoreTimingMatch(cardanoProfile, midnightProfile),
            amountMatch: scoreAmountMatch(cardanoProfile, midnightProfile),
            patternMatch: scorePatternMatch(midnightProfile)
          },
          updatedAt: Date.now()
        }

        correlations.set(correlationKey, correlation)
        events.dispatchEvent(new CustomEvent('correlationUpdate', { detail: correlation }))
      }
    }
  }
}

function getCorrelations() {
  return [...correlations.values()]
}

function getCardanoProfiles() {
  return [...cardanoProfiles.values()]
}

function getMidnightProfiles() {
  return [...midnightProfiles.values()]
}

export {
  events,
  registerCardanoEvent,
  registerMidnightEvent,
  registerRegistrationLink,
  getCorrelations,
  getCardanoProfiles,
  getMidnightProfiles
}
