import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { SensorCard } from '../components/SensorCard.jsx'
import { MissionHealthReport } from '../components/MissionHealthReport.jsx'
import { REPLAY_SPEEDS, REPLAY_WINDOWS } from '../config/app.js'
import { SENSORS, sensorStatus } from '../config/sensors.js'
import { PHASES, flightSummary, reconstructFlight } from '../lib/flightPath.js'
import './FlightReplay.css'
import { formatDuration } from '../lib/missionReport.js'

// three.js only loads when this tab is opened.
const FlightScene = lazy(() => import('../components/flight3d/FlightScene.jsx'))

const pad = (n) => String(n).padStart(2, '0')
const dateValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeValue = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

const clock = (ms) =>
  new Date(ms).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

const duration = (ms) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${pad(s % 60)} s`
}

// Date + time pickers, the window length, and the transport bar.
function ReplayControls({ replay }) {
  const { range, window, readings, loading, error, load, playhead, seek, playing, togglePlay, speed, setSpeed } =
    replay

  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [windowId, setWindowId] = useState('5m')
  const windowMs = REPLAY_WINDOWS.find((w) => w.id === windowId)?.ms ?? 300_000

  // Prefill with the end of the recording, which is the window most people want.
  useEffect(() => {
    if (!range?.last || date) return
    const end = new Date(range.last)
    const start = new Date(end.getTime() - windowMs)
    setDate(dateValue(start))
    setTime(timeValue(start))
  }, [range, date, windowMs])

  const submit = (event) => {
    event.preventDefault()
    if (!date || !time) return
    const start = new Date(`${date}T${time}`)
    if (Number.isNaN(start.getTime())) return
    load(start.getTime(), windowMs)
  }

  const jumpToDay = (day) => {
    const first = new Date(day.first)
    setDate(dateValue(first))
    setTime(timeValue(first))
    load(first.getTime(), windowMs)
  }

  const first = readings[0]?.time
  const last = readings[readings.length - 1]?.time

  return (
    <section className="card replay" aria-label="History replay controls">
      <form className="replay__pick" onSubmit={submit}>
        <label className="replay__field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="replay__field">
          <span>Start time</span>
          <input type="time" step="1" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <label className="replay__field">
          <span>Window</span>
          <select value={windowId} onChange={(e) => setWindowId(e.target.value)}>
            {REPLAY_WINDOWS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn--accent" disabled={loading}>
          {loading ? 'Loading…' : 'Load flight'}
        </button>
      </form>

      {range?.first ? (
        <p className="replay__range">
          Recording runs {clock(Date.parse(range.first))} → {clock(Date.parse(range.last))} ·{' '}
          {range.total_readings.toLocaleString()} readings
        </p>
      ) : (
        <p className="replay__range">Checking what the database holds…</p>
      )}

      {range?.days?.length > 0 && (
        <ul className="replay__days">
          {range.days.slice(0, 8).map((day) => (
            <li key={day.date}>
              <button type="button" className="btn btn--sm" onClick={() => jumpToDay(day)}>
                {day.date}
                <span>{day.readings.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="replay__error">{error}</p>}

      {readings.length > 1 && (
        <div className="replay__transport">
          <button type="button" className="btn btn--accent" onClick={togglePlay}>
            {playing ? 'Pause' : 'Play'}
          </button>

          <input
            className="replay__scrub"
            type="range"
            min={first}
            max={last}
            step={100}
            value={playhead ?? first}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Playback position"
          />

          <span className="replay__clock">{playhead != null ? clock(playhead) : '—'}</span>

          <div className="segmented replay__speed" role="group" aria-label="Playback speed">
            {REPLAY_SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      )}

      {window && readings.length > 0 && (
        <p className="replay__loaded">
          Loaded {readings.length.toLocaleString()} readings covering {duration(last - first)}.
          {window.truncated && ' The window held more than the server returns at once, so this is the first part of it.'}
        </p>
      )}
    </section>
  )
}

export function FlightReplay({ telemetry, stale, source, replay }) {
  const { latest, history } = telemetry
  const isReplay = source === 'replay'

  // In replay the whole loaded window is reconstructed once, so the aircraft can
  // be scrubbed anywhere inside it. Live mode reconstructs the rolling history.
  const basis = isReplay ? replay.readings : history
  const frames = useMemo(() => reconstructFlight(basis), [basis])
  const summary = useMemo(() => flightSummary(frames), [frames])

  

  // Live mode has no playhead of its own, so the scene advances its own clock.
  const liveTimeRef = useRef(null)
  const timeRef = isReplay ? replay.playheadRef : liveTimeRef

  const valueOf = (sensor) => latest?.values[sensor.key] ?? null
  const statusOf = (sensor) => (stale ? 'nodata' : sensorStatus(sensor, valueOf(sensor)))

  return (
    <div className="replay-tab">
      {isReplay ? (
        <ReplayControls replay={replay} />
      ) : (
        <p className="replay__hint card">
          Flying the live stream. Switch the source to <strong>Replay</strong> in the top bar to pick a date and
          time from the recording instead.
        </p>
      )}

      {frames.length > 1 ? (
        <Suspense fallback={<div className="replay__loading card">Building the site…</div>}>
          <FlightScene frames={frames} timeRef={timeRef} autoAdvance={!isReplay} />
        </Suspense>
      ) : (
        <div className="replay__loading card">
          {isReplay ? 'Load a window to fly it.' : 'Waiting for enough readings to reconstruct a flight.'}
        </div>
      )}

      {summary && (
        <dl className="card replay__summary" aria-label="Flight summary">
          <div>
            <dt>Readings</dt>
            <dd>{summary.readings.toLocaleString()}</dd>
          </div>

          <div>
            <dt>Covered</dt>
            <dd>{duration(summary.durationMs)}</dd>
          </div>

          <div>
            <dt>Track flown</dt>
            <dd>{(summary.distance / 1000).toFixed(2)} km</dd>
          </div>

          <div>
            <dt>Altitude band</dt>
            <dd>
              {Math.round(summary.lowest)}–{Math.round(summary.highest)} m
            </dd>
          </div>

          <div className="replay__phases">
            <dt>Phases</dt>
            <dd>
              {summary.phases.map((p) => (
                <span key={p.name} className="replay__phase">
                  {p.label} <strong>{Math.round(p.seconds)}s</strong>
                </span>
              ))}
            </dd>
          </div>
        </dl>
      )}

      

      <section className="replay__params" aria-label="Parameters at this moment">
        <header className="section-head">
          <div>
            <h2 className="section-title">Parameters at this moment</h2>
            <p className="section-sub">
              {latest
                ? `${clock(latest.time)}${latest.engineId ? ` · ${latest.engineId}` : ''}${
                    frames.length ? ` · ${PHASES[frames[frames.length - 1].phase]?.label ?? ''}` : ''
                  }`
                : 'No reading at this position.'}
            </p>
          </div>
        </header>

        <div className="replay__grid">
          {SENSORS.map((sensor) => (
            <SensorCard
              key={sensor.key}
              sensor={sensor}
              value={valueOf(sensor)}
              status={statusOf(sensor)}
              history={history}
            />
          ))}
        </div>
      </section>
      <MissionHealthReport
        readings={basis}
        summary={summary}
      />
    </div>
  )
}
