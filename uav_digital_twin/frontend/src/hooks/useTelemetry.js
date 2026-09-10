import { useEffect, useRef, useState } from 'react'
import {
  API_BASE,
  BACKFILL_LIMIT,
  HISTORY_SIZE,
  POLL_INTERVAL_MS,
  TREND_RANGES,
  WS_PATH,
  WS_RETRY_MS,
} from '../config/app.js'
import { SENSORS } from '../config/sensors.js'
import { simulateReading } from '../lib/simulator.js'

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`

// Database history older than the widest trend range is never shown
const BACKFILL_MAX_AGE_MS = Math.max(...TREND_RANGES.map((r) => r.ms))

// The simulator sends UTC. Some DB drivers hand it back without a zone
// ("2026-09-10T14:46:12"), which the browser would read as local time.
function withZone(timestamp) {
  if (typeof timestamp !== 'string') return timestamp
  return /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(timestamp) ? timestamp : `${timestamp}Z`
}

// Accepts both shapes the backend produces:
//   WebSocket / simulator / GET /sensor-history: { engine_id, timestamp, rpm, cht, ... }
//   GET /latest-sensor-data:                     { id, engine_id, timestamp, sensors: { rpm, cht, ... } }
// receivedAt is when this browser got the reading live; 0 = loaded from the database.
function normalize(msg, receivedAt) {
  const timestamp = withZone(msg?.timestamp)
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) return null
  const src = msg.sensors ?? msg
  const values = {}
  for (const { key } of SENSORS) values[key] = typeof src[key] === 'number' ? src[key] : null
  return { engineId: msg.engine_id ?? null, timestamp, time, receivedAt, values }
}

// Keeps the buffer sorted by time with one entry per timestamp. Live readings
// normally just append; database history is merged in wherever it belongs.
// If the same reading arrives twice, the copy already held wins.
function addReadings(prev, incoming) {
  const last = prev.at(-1)
  if (incoming.length === 1 && (!last || incoming[0].time > last.time)) {
    const next = prev.length >= HISTORY_SIZE ? prev.slice(prev.length - HISTORY_SIZE + 1) : prev.slice()
    next.push(incoming[0])
    return next
  }

  const byTime = new Map(prev.map((r) => [r.time, r]))
  const sizeBefore = byTime.size
  for (const r of incoming) if (!byTime.has(r.time)) byTime.set(r.time, r)
  if (byTime.size === sizeBefore) return prev

  const merged = [...byTime.values()].sort((a, b) => a.time - b.time)
  return merged.length > HISTORY_SIZE ? merged.slice(merged.length - HISTORY_SIZE) : merged
}

/**
 * Streams engine readings into React state.
 *
 * source 'backend':   loads recent history from GET /sensor-history, then streams
 *                     over WebSocket /ws/telemetry. While the socket is down it
 *                     polls GET /latest-sensor-data every second and keeps
 *                     retrying the socket, so the gauges keep moving either way.
 * source 'simulator': generates readings in the browser, no backend needed.
 *
 * Returns { latest, history, link, transport }
 *   history:   readings sorted oldest -> newest, at most HISTORY_SIZE
 *   link:      'connecting' | 'open' | 'offline'
 *   transport: 'websocket' | 'rest' | 'simulator' | null
 */
export function useTelemetry({ source, onAnomaly }) {
  const [history, setHistory] = useState([])
  const [link, setLink] = useState('connecting')
  const [transport, setTransport] = useState(null)

  const onAnomalyRef = useRef(onAnomaly)
  useEffect(() => {
    onAnomalyRef.current = onAnomaly
  })

  useEffect(() => {
    setHistory([])

    const push = (msg) => {
      const reading = normalize(msg, Date.now())
      if (reading) setHistory((prev) => addReadings(prev, [reading]))
    }

    if (source === 'simulator') {
      setLink('open')
      setTransport('simulator')
      push(simulateReading())
      const timer = setInterval(() => push(simulateReading()), 1000)
      return () => clearInterval(timer)
    }

    let disposed = false
    let socket = null
    let pollTimer = null
    let retryTimer = null
    setLink('connecting')
    setTransport(null)

    async function backfill() {
      try {
        const res = await fetch(`${API_BASE}/sensor-history?limit=${BACKFILL_LIMIT}`)
        if (!res.ok) return
        const body = await res.json()
        if (disposed || !Array.isArray(body.readings)) return
        const cutoff = Date.now() - BACKFILL_MAX_AGE_MS
        const rows = body.readings.map((r) => normalize(r, 0)).filter((r) => r && r.time >= cutoff)
        if (rows.length) setHistory((prev) => addReadings(prev, rows))
      } catch {
        // History is a nice-to-have; the live stream works without it
      }
    }

    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/latest-sensor-data`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        if (body.error) throw new Error(body.error)
        if (disposed) return
        // Same row as last poll = nothing new; addReadings drops it, so the stream goes stale
        if (body.sensors) push(body)
        setLink('open')
        setTransport('rest')
      } catch {
        if (!disposed) setLink('offline')
      }
    }

    function startPolling() {
      if (pollTimer || disposed) return
      poll()
      pollTimer = setInterval(poll, POLL_INTERVAL_MS)
    }

    function stopPolling() {
      clearInterval(pollTimer)
      pollTimer = null
    }

    function connect() {
      if (disposed) return
      const ws = new WebSocket(WS_URL)
      socket = ws

      ws.onopen = () => {
        stopPolling()
        setLink('open')
        setTransport('websocket')
      }

      ws.onmessage = (event) => {
        let msg
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        if (msg.type === 'anomaly') onAnomalyRef.current?.(msg)
        else push(msg)
      }

      ws.onclose = () => {
        if (disposed) return
        startPolling()
        retryTimer = setTimeout(connect, WS_RETRY_MS)
      }
    }

    backfill()
    connect()

    return () => {
      disposed = true
      socket?.close()
      stopPolling()
      clearTimeout(retryTimer)
    }
  }, [source])

  return { latest: history.at(-1) ?? null, history, link, transport }
}
