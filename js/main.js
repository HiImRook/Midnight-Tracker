import { startCardanoWatcher, stopCardanoWatcher, setBlockfrostKey } from './cardanoWatcher.js'
import { startMidnightWatcher, stopMidnightWatcher } from './midnightWatcher.js'
import { events, getCorrelations } from './correlator.js'
import { MIDNIGHT_RPC_WS_DEFAULT } from './config.js'

const correlationBody = document.getElementById('correlation-body')
const statusIndicator = document.getElementById('status-indicator')
const cardanoCount = document.getElementById('cardano-count')
const midnightCount = document.getElementById('midnight-count')
const highCount = document.getElementById('high-count')
const mediumCount = document.getElementById('medium-count')
const logFeed = document.getElementById('log-feed')
const blockfrostInput = document.getElementById('blockfrost-key')
const midnightRpcInput = document.getElementById('midnight-rpc')
const connectBtn = document.getElementById('btn-connect')
const stopBtn = document.getElementById('btn-stop')

let chart = null

function initChart() {
  const ctx = document.getElementById('correlation-chart').getContext('2d')
  chart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Correlation Confidence',
        data: [],
        backgroundColor: (context) => {
          const score = context.raw?.y || 0
          if (score >= 0.70) return 'rgba(252, 129, 129, 0.8)'
          if (score >= 0.40) return 'rgba(246, 224, 94, 0.8)'
          return 'rgba(104, 211, 145, 0.8)'
        },
        pointRadius: 6
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              const corr = context.raw
              return [
                `Score: ${(corr.y * 100).toFixed(1)}%`,
                `Cardano: ${corr.cardanoAddress?.slice(0, 16)}...`,
                `Midnight: ${corr.midnightAddress?.slice(0, 16)}...`,
                `Label: ${corr.label}`
              ]
            }
          }
        }
      },
      scales: {
        x: { display: false },
        y: {
          min: 0,
          max: 1,
          title: { display: true, text: 'Confidence Score', color: '#a0aec0' },
          ticks: { color: '#a0aec0' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  })
}

function updateChart(correlations) {
  if (!chart) return
  chart.data.datasets[0].data = correlations.map((corr, index) => ({
    x: index,
    y: corr.score,
    cardanoAddress: corr.cardanoAddress,
    midnightAddress: corr.midnightAddress,
    label: corr.label
  }))
  chart.update('none')
}

function updateTable(correlations) {
  correlationBody.innerHTML = ''
  const sorted = [...correlations].sort((a, b) => b.score - a.score)
  for (const corr of sorted) {
    const row = document.createElement('tr')
    row.className = `correlation-row ${corr.label.toLowerCase()}`
    row.innerHTML = `
      <td class="addr">${corr.cardanoAddress?.slice(0, 20)}...</td>
      <td class="addr">${corr.midnightAddress?.slice(0, 20)}...</td>
      <td class="score">${(corr.score * 100).toFixed(1)}%</td>
      <td class="label ${corr.label.toLowerCase()}">${corr.label}</td>
      <td class="vectors">
        R:${(corr.vectors.registrationLink * 100).toFixed(0)}%
        T:${(corr.vectors.timingMatch * 100).toFixed(0)}%
        A:${(corr.vectors.amountMatch * 100).toFixed(0)}%
        P:${(corr.vectors.patternMatch * 100).toFixed(0)}%
      </td>
    `
    correlationBody.appendChild(row)
  }
}

function updateStats(correlations) {
  const high = correlations.filter(c => c.label === 'HIGH').length
  const medium = correlations.filter(c => c.label === 'MEDIUM').length
  const cardanoAddresses = new Set(correlations.map(c => c.cardanoAddress)).size
  const midnightAddresses = new Set(correlations.map(c => c.midnightAddress)).size
  highCount.textContent = high
  mediumCount.textContent = medium
  cardanoCount.textContent = cardanoAddresses
  midnightCount.textContent = midnightAddresses
}

function appendLog(message) {
  const line = document.createElement('div')
  line.className = 'log-line'
  line.textContent = `[${new Date().toISOString()}] ${message}`
  logFeed.prepend(line)
  if (logFeed.children.length > 100) logFeed.removeChild(logFeed.lastChild)
}

function setStatus(state) {
  statusIndicator.className = `status-dot ${state}`
  statusIndicator.title = state
}

function onCorrelationUpdate(event) {
  const corr = event.detail
  const correlations = getCorrelations()
  updateTable(correlations)
  updateChart(correlations)
  updateStats(correlations)
  appendLog(`${corr.label} match — Cardano ${corr.cardanoAddress?.slice(0, 12)}... ↔ Midnight ${corr.midnightAddress?.slice(0, 12)}... [${(corr.score * 100).toFixed(1)}%]`)
}

connectBtn.addEventListener('click', () => {
  const key = blockfrostInput.value.trim()
  const rpc = midnightRpcInput.value.trim() || MIDNIGHT_RPC_WS_DEFAULT

  if (!key) {
    appendLog('⚠ Blockfrost project ID required')
    return
  }

  sessionStorage.setItem('blockfrost_key', key)
  sessionStorage.setItem('midnight_rpc', rpc)

  setBlockfrostKey(key)
  setStatus('active')
  appendLog('Watchers started')
  startCardanoWatcher()
  startMidnightWatcher(rpc)
})

stopBtn.addEventListener('click', () => {
  sessionStorage.removeItem('blockfrost_key')
  sessionStorage.removeItem('midnight_rpc')
  setStatus('inactive')
  appendLog('Watchers stopped')
  stopCardanoWatcher()
  stopMidnightWatcher()
})

window.addEventListener('midnightBlock', (event) => {
  appendLog(`Midnight block ${event.detail.blockNumber}`)
})

events.addEventListener('correlationUpdate', onCorrelationUpdate)

initChart()

const savedKey = sessionStorage.getItem('blockfrost_key')
const savedRpc = sessionStorage.getItem('midnight_rpc')

if (savedKey) {
  blockfrostInput.value = savedKey
  midnightRpcInput.value = savedRpc || MIDNIGHT_RPC_WS_DEFAULT
  setBlockfrostKey(savedKey)
  setStatus('active')
  appendLog('Session restored — watchers started')
  startCardanoWatcher()
  startMidnightWatcher(savedRpc || MIDNIGHT_RPC_WS_DEFAULT)
} else {
  appendLog('Midnight Tracker initialized — enter Blockfrost key to begin')
}
