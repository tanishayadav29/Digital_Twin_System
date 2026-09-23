import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, REPLAY_MAX_READINGS, REPLAY_SPEEDS, REPLAY_UI_HZ } from '../config/app.js'
import { normalize } from '../lib/readings.js'

// Binary search: index of the last reading at or before `time`.
function indexAt(readings, time) {
  if (!readings.length || time <= readings[0].time) return 0
  if (time >= readings[readings.length - 1].time) return readings.length - 1

  let lo = 0
  let hi = readings.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (readings[mid].time <= time) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * History replay: loads a window of recorded readings and plays it back.
 *
 * Returns the same { latest, history, link, transport } shape as
 * useTelemetry, so every existing tab - live gauges, trends, the engine
 * simulation - works unchanged against a moment in the past. `replay` carries
 * the transport controls on top of that.
 *
 * The playhead is kept in a ref and advanced every animation frame so the 3D
 * flight stays smooth, but only committed to React state about 12 times a
 * second, so the rest of the dashboard is not re-rendered 60 times a second.
 */
export function useReplay({ active }) {
  const [range, setRange] = useState(null)
  const [readings, setReadings] = useState([])
  const [window, setWindow] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(REPLAY_SPEEDS[1] ?? 4)
  const [playhead, setPlayhead] = useState(null)

  // Smooth playhead for the 3D scene; `playhead` state is the throttled copy.
  const playheadRef = useRef(null)
  const readingsRef = useRef(readings)
  readingsRef.current = readings

  // What the database actually holds, so the date picker isn't a guess.
  useEffect(() => {
    if (!active || range) return undefined

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/data-range`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        if (cancelled) return
        if (body.error) throw new Error(body.error)
        setRange(body)
      } catch (err) {
        if (!cancelled) setError(`Could not read the recording range: ${err.message}`)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [active, range])

  const load = useCallback(async (startMs, durationMs) => {
    const start = new Date(startMs)
    const end = new Date(startMs + durationMs)

    setLoading(true)
    setError(null)
    setPlaying(false)

    try {
      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
        limit: String(REPLAY_MAX_READINGS),
      })
      const res = await fetch(`${API_BASE}/sensor-history?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      if (body.error) throw new Error(body.error)

      const rows = (body.readings ?? [])
        .map((r) => normalize(r, 0))
        .filter(Boolean)
        .sort((a, b) => a.time - b.time)

      setReadings(rows)
      setWindow({ start: startMs, end: startMs + durationMs, truncated: Boolean(body.truncated) })

      if (rows.length) {
        playheadRef.current = rows[0].time
        setPlayhead(rows[0].time)
        setPlaying(true)
      } else {
        playheadRef.current = null
        setPlayhead(null)
        setError('No readings were recorded in that window. Try another time or a longer window.')
      }
    } catch (err) {
      setReadings([])
      setWindow(null)
      playheadRef.current = null
      setPlayhead(null)
      setError(`Could not load that window: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const seek = useCallback((time) => {
    playheadRef.current = time
    setPlayhead(time)
  }, [])

  // Playback clock.
  useEffect(() => {
    if (!active || !playing || readings.length < 2) return undefined

    const first = readings[0].time
    const last = readings[readings.length - 1].time
    let frame = 0
    let previous = performance.now()
    let lastCommit = 0

    const tick = (now) => {
      const wall = Math.min(now - previous, 250)
      previous = now

      let next = (playheadRef.current ?? first) + wall * speed
      if (next >= last) {
        next = last
        playheadRef.current = next
        setPlayhead(next)
        setPlaying(false)
        return
      }

      playheadRef.current = next
      if (now - lastCommit >= 1000 / REPLAY_UI_HZ) {
        lastCommit = now
        setPlayhead(next)
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, playing, speed, readings])

  // Everything up to the playhead, so the trends tab draws the flight so far
  // rather than the whole window at once.
  const cursor = useMemo(
    () => (readings.length && playhead != null ? indexAt(readings, playhead) : -1),
    [readings, playhead],
  )

  const history = useMemo(() => (cursor < 0 ? [] : readings.slice(0, cursor + 1)), [readings, cursor])
  const latest = cursor < 0 ? null : readings[cursor]

  const togglePlay = useCallback(() => {
    setPlaying((value) => {
      if (value) return false
      // Restarting at the very end rewinds, otherwise play stalls instantly.
      const rows = readingsRef.current
      if (rows.length && playheadRef.current >= rows[rows.length - 1].time) {
        playheadRef.current = rows[0].time
        setPlayhead(rows[0].time)
      }
      return true
    })
  }, [])

  return {
    latest,
    history,
    link: loading ? 'connecting' : readings.length ? 'open' : 'offline',
    transport: readings.length ? 'replay' : null,
    replay: {
      range,
      readings,
      window,
      loading,
      error,
      load,
      playhead,
      playheadRef,
      seek,
      playing,
      togglePlay,
      setPlaying,
      speed,
      setSpeed,
      atEnd: readings.length > 0 && playhead != null && playhead >= readings[readings.length - 1].time,
    },
  }
}
