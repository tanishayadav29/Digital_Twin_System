import {
  SENSOR_LABELS,
  formatDuration,
  missionReadings,
} from '../lib/missionReport.js'

import { PART_BY_ID } from '../config/engineParts.js'
import { healthFor, overallHealth, worstPart } from '../lib/health.js'
import { withZone } from '../lib/readings.js'

import './MissionHealthReport.css'
import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config/app.js'

// Decimals per sensor in the telemetry table (vibration is ~0.3 g)
const SENSOR_DIGITS = {
  rpm: 0,
  fuel_flow: 2,
  vibration: 3,
  battery_voltage: 2,
  alternator_current: 2,
}

// Same as lib/health.js: a fault keeps its parts down this long after it ends
const FAULT_MEMORY_MS = 60_000

// A fault counts as still happening if it was flagged this close to the last reading
const ACTIVE_FAULT_MS = 30_000

// ...and the last reading is this recent (a replayed old window is never "active")
const LIVE_DATA_MS = 120_000

const SEVERITY_RANK = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
}

// Same thresholds lib/health.js uses for a part's status
const statusOf = (health) => {
  if (health == null || !Number.isFinite(health)) return 'nodata'
  if (health >= 0.85) return 'normal'
  if (health >= 0.6) return 'warning'
  return 'critical'
}

const parseTime = (value) => {
  const time = Date.parse(withZone(value))
  return Number.isFinite(time) ? time : null
}

const formatSeconds = (seconds) => {
  if (seconds == null || !Number.isFinite(seconds)) return 'N/A'
  return formatDuration(Math.max(seconds, 1) * 1000)
}

const formatNumber = (value, digits = 1) => {
  if (value == null || !Number.isFinite(value)) {
    return 'N/A'
  }

  return value.toFixed(digits)
}

const sensorUnit = {
  rpm: 'RPM',
  cht: '°C',
  egt: '°C',
  oil_pressure: 'psi',
  oil_temperature: '°C',
  fuel_flow: 'L/h',
  vibration: 'g',
  battery_voltage: 'V',
  alternator_current: 'A',
  injection_timing: '°',
}

const healthPercent = (value) => {
  if (value == null || !Number.isFinite(value)) {
    return 'N/A'
  }

  return `${Math.round(value * 100)}%`
}

const healthStatus = (status) => {
  if (!status) return 'NO DATA'

  return status
    .replaceAll('_', ' ')
    .toUpperCase()
}

const formatFaultName = (faultType = '') =>
  faultType
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())

const formatFaultTime = (value) => {
  if (!value) return 'N/A'

  // Backend timestamps are UTC without a zone
  const date = new Date(withZone(value))

  return Number.isNaN(date.getTime())
    ? 'N/A'
    : date.toLocaleString()
}

export function MissionHealthReport({
  readings = [],
  summary = null,
  description = 'Historical engine telemetry analysis for the selected replay window.',
}) {
  const report = missionReadings(readings)
  // Fault events grouped into episodes by the backend
  // (one row per fault, not one per flagged second)
  const [faults, setFaults] = useState([])
  const [faultLoading, setFaultLoading] = useState(true)
  const [faultError, setFaultError] = useState('')
  const [rulData, setRulData] = useState(null)
  const [rulLoading, setRulLoading] = useState(true)
  const [rulError, setRulError] = useState('')

 useEffect(() => {
  let cancelled = false

  const engineId = readings[0]?.engineId || null
  const missionStart = readings[0]?.time || null

  async function loadFaults() {
    if (!missionStart) {
      setFaults([])
      setFaultLoading(false)
      return
    }

    try {
      // No setFaultLoading(true) here: a live window refetches every
      // 30 s and the table should not flash "Loading" each time
      setFaultError('')

      const params = new URLSearchParams()

      if (engineId) {
        params.set('engine_id', engineId)
      }

      /*
       * The first reading identifies the selected mission.
       * We deliberately do NOT depend on the entire readings array,
       * because replay/live updates can change that array every second.
       */
      params.set('start', missionStart)

      const missionEnd =
        readings[readings.length - 1]?.time || null

      if (missionEnd) {
        params.set('end', missionEnd)
      }

      params.set('episodes', 'true')

      const response = await fetch(
        `${API_BASE}/fault-summary?${params.toString()}`,
      )

      if (!response.ok) {
        throw new Error(
          `Failed to load faults: ${response.status}`,
        )
      }

      const data = await response.json()

      if (!cancelled) {
        if (data.error) {
          throw new Error(data.error)
        }

        setFaults(
          Array.isArray(data.episodes)
            ? data.episodes
            : [],
        )
      }
    } catch (error) {
      if (!cancelled) {
        setFaultError(
          error.message || 'Unable to load fault data.',
        )
      }
    } finally {
      if (!cancelled) {
        setFaultLoading(false)
      }
    }
  }

  loadFaults()

  return () => {
    cancelled = true
  }
  // The window's end only matters in 30 s steps, so a live window
  // that grows every second refetches twice a minute, not every reading.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  readings[0]?.engineId,
  readings[0]?.time,
  Math.floor((readings[readings.length - 1]?.time ?? 0) / 30_000),
])

const rulEngineId =
  readings[0]?.engineId || null

useEffect(() => {
  let cancelled = false

  async function loadRul() {
    try {
      setRulLoading(true)
      setRulError('')

      const engineId = rulEngineId

      if (!engineId) {
        setRulData(null)
        setRulLoading(false)
        return
      }

      const response = await fetch(
        `${API_BASE}/rul-years/${encodeURIComponent(engineId)}`,
      )

      if (!response.ok) {
        throw new Error(
          `Failed to load RUL: ${response.status}`,
        )
      }

      const data = await response.json()

      if (!cancelled) {
        if (data.error) {
          throw new Error(data.error)
        }

        setRulData(data)
      }
    } catch (error) {
      if (!cancelled) {
        setRulError(
          error.message || 'Unable to load degradation data.',
        )
      }
    } finally {
      if (!cancelled) {
        setRulLoading(false)
      }
    }
  }

  loadRul()

  return () => {
    cancelled = true
  }
}, [rulEngineId])

const formatRulFlights = (value) => {
  if (
    value == null ||
    !Number.isFinite(Number(value))
  ) {
    return '—'
  }

  return `${Math.round(
    Number(value),
  ).toLocaleString()} flights`
}

/*
   * Health over the WHOLE window, not just the last reading.
   * Every reading goes through the same healthFor() the Engine
   * Simulation tab uses; a recorded fault episode caps the health
   * of its parts while it is happening (plus FAULT_MEMORY_MS after,
   * like a live alert). The worst point is the mission's health.
   */
  const missionHealth = useMemo(() => {
    const spans = faults
      .map((episode) => ({
        fault_type: episode.fault_type,
        severity: episode.severity,
        start: parseTime(episode.start),
        end: parseTime(episode.end),
      }))
      .filter((span) => span.start != null && span.end != null)

    let worst = null
    let last = null

    for (const reading of readings) {
      const at = new Date(reading.time).toISOString()

      const alerts = spans
        .filter(
          (span) =>
            span.start <= reading.time &&
            reading.time <= span.end + FAULT_MEMORY_MS,
        )
        .map((span) => ({
          fault_type: span.fault_type,
          severity: span.severity,
          timestamp: at,
          acknowledged: false,
        }))

      const health = healthFor({
        latest: {
          time: reading.time,
          engineId: reading.engineId,
          values: reading.values ?? {},
          fault: reading.fault ?? {},
        },
        stale: false,
        alerts,
      })

      const overall = overallHealth(health)

      if (overall == null) continue

      const point = {
        time: reading.time,
        overall,
        part: worstPart(health),
      }

      if (!worst || overall < worst.overall) worst = point
      last = point
    }

    return { worst, last }
  }, [readings, faults])

  const worstPoint = missionHealth.worst
  const endPoint = missionHealth.last

  const engine = worstPoint?.overall ?? null
  const worst = worstPoint?.part ?? null

  // Every part at ~100%: there is no weak component to name
  const allHealthy = worst != null && worst.health >= 0.995

  const worstPartLabel = !worst
    ? 'N/A'
    : allHealthy
      ? 'None — all components healthy'
      : PART_BY_ID[worst.id]?.label ?? worst.id

  const engineStatus = statusOf(worst?.health)
  const endStatus = statusOf(endPoint?.part?.health)

  const engineId =
    readings[0]?.engineId ??
    readings[0]?.engine_id ??
    'ENGINE_001'

  const firstTime = readings[0]?.time
  const lastTime = readings[readings.length - 1]?.time

  const startTime =
    typeof firstTime === 'number'
      ? new Date(firstTime).toLocaleString()
      : 'N/A'

  const endTime =
    typeof lastTime === 'number'
      ? new Date(lastTime).toLocaleString()
      : 'N/A'

  const worstTime =
    worstPoint && !allHealthy
      ? new Date(worstPoint.time).toLocaleTimeString()
      : null

  // ----------------------------------------------------------
  // Fault episodes
  // ----------------------------------------------------------

  const severityCounts = faults.reduce(
    (counts, episode) => {
      const key = String(episode.severity ?? '').toLowerCase()

      if (key in counts) counts[key] += 1

      return counts
    },
    {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  )

  // Worst severity first, then the longest
  const primaryFault = [...faults].sort(
    (a, b) =>
      (SEVERITY_RANK[b.severity] ?? 0) -
        (SEVERITY_RANK[a.severity] ?? 0) ||
      (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0),
  )[0] ?? null

  const primaryFaultName = primaryFault
    ? formatFaultName(primaryFault.fault_type)
    : 'No significant fault detected'

  // Short-term RUL = seconds until a fault is FULLY DEVELOPED.
  // Only meaningful while that fault is still happening, and only
  // for live data - never for an old replay window.
  const lastEpisode = faults[faults.length - 1] ?? null
  const lastEpisodeEnd = parseTime(lastEpisode?.end)

  const activeFault =
    lastEpisode &&
    lastEpisodeEnd != null &&
    typeof lastTime === 'number' &&
    lastTime - lastEpisodeEnd <= ACTIVE_FAULT_MS &&
    Date.now() - lastTime <= LIVE_DATA_MS
      ? lastEpisode
      : null

  const liveRul = readings[readings.length - 1]?.fault?.rul?.seconds

  const activeFaultRul =
    typeof liveRul === 'number'
      ? liveRul
      : activeFault?.latest_rul_seconds ?? null

  const maintenanceStatus =
    severityCounts.critical > 0
      ? 'Critical attention required'
      : severityCounts.high > 0
        ? 'Maintenance attention required'
        : faults.length > 0
          ? 'Monitor and schedule inspection'
          : 'No maintenance issue detected'

  const maintenanceAction =
    severityCounts.critical > 0
      ? 'Inspect the affected engine system before the next mission.'
      : severityCounts.high > 0
        ? 'Schedule inspection of the affected component and review the fault trend.'
        : faults.length > 0
          ? 'Continue monitoring the affected parameters and include them in the next inspection.'
          : 'Continue normal monitoring and routine preventive maintenance.'

  const episodeText = `${faults.length} fault ${
    faults.length === 1 ? 'episode' : 'episodes'
  }`

  const recoveredText =
    engineStatus !== 'normal' && endStatus === 'normal'
      ? ' The engine had recovered by the end of the recording, but the fault should still be inspected.'
      : ''

  const conclusionText =
    engineStatus === 'critical'
      ? `The engine reached a critical condition during this mission (lowest health ${healthPercent(engine)} at ${worstTime}), mainly due to ${primaryFaultName}. Inspect the affected components before the next mission.${recoveredText}`
      : engineStatus === 'warning'
        ? `The engine showed warning-level conditions during this mission (lowest health ${healthPercent(engine)} at ${worstTime}). The primary concern was ${primaryFaultName}. Continued monitoring and scheduled inspection are recommended.${recoveredText}`
        : faults.length > 0
          ? `${episodeText} recorded (primary: ${primaryFaultName}), but engine health stayed within normal limits throughout. Continue monitoring the affected parameters.`
          : 'The selected mission completed without recorded engine faults requiring additional attention.'
  return (
    <section
      className="mission-report"
      aria-label="Mission health report"
    >
      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="mission-report__header">
        <div>
          <p className="mission-report__eyebrow">
            Digital Twin Analysis
          </p>

          <h2>Mission Health Report</h2>

          <p className="mission-report__subtitle">
            {description}
          </p>
        </div>

        <div className="mission-report__engine">
          <span>Engine</span>
          <strong>{engineId}</strong>
        </div>
      </header>

      {/* =====================================================
          MISSION OVERVIEW
      ===================================================== */}

      <section className="mission-report__section">
        <div className="mission-report__section-head">
          <div>
            <h3>Mission Overview</h3>

            <p>
              Summary of the selected mission recording.
            </p>
          </div>
        </div>

        <div className="mission-report__overview">
          <div className="mission-report__metric">
            <span>Readings</span>

            <strong>
              {report.count.toLocaleString()}
            </strong>
          </div>

          <div className="mission-report__metric">
            <span>Duration</span>

            <strong>
              {formatDuration(report.durationMs)}
            </strong>
          </div>

          <div className="mission-report__metric">
            <span>Mission start</span>

            <strong>{startTime}</strong>
          </div>

          <div className="mission-report__metric">
            <span>Mission end</span>

            <strong>{endTime}</strong>
          </div>

          {summary && (
            <>
              <div className="mission-report__metric">
                <span>Track flown</span>

                <strong>
                  {Number.isFinite(summary.distance)
                    ? `${(
                        summary.distance / 1000
                      ).toFixed(2)} km`
                    : 'N/A'}
                </strong>
              </div>

              <div className="mission-report__metric">
                <span>Altitude band</span>

                <strong>
                  {Number.isFinite(summary.lowest) &&
                  Number.isFinite(summary.highest)
                    ? `${Math.round(
                        summary.lowest,
                      )}–${Math.round(
                        summary.highest,
                      )} m`
                    : 'N/A'}
                </strong>
              </div>
            </>
          )}
        </div>
      </section>

      {/* =====================================================
          ENGINE HEALTH
      ===================================================== */}

      <section className="mission-report__section">
        <div className="mission-report__section-head">
          <div>
            <h3>Engine Health</h3>

            <p>
              Lowest engine condition reached during the
              mission, from every reading and the recorded
              faults.
            </p>
          </div>
        </div>

        <div className="mission-report__health">
          <div className="mission-report__health-main">
            <span>
              Lowest health
              {worstTime ? ` (at ${worstTime})` : ''}
            </span>

            <strong>
              {healthPercent(engine)}
            </strong>

            <span
              className={`mission-report__health-status mission-report__health-status--${engineStatus}`}
            >
              {healthStatus(engineStatus)}
            </span>
          </div>

          <div className="mission-report__health-detail">
            <span>Weakest component</span>

            <strong>{worstPartLabel}</strong>
          </div>

          <div className="mission-report__health-detail">
            <span>Component health</span>

            <strong>
              {healthPercent(worst?.health)}
            </strong>
          </div>

          <div className="mission-report__health-detail">
            <span>At end of mission</span>

            <strong>
              {healthPercent(endPoint?.overall)}{' '}
              {healthStatus(endStatus)}
            </strong>
          </div>
        </div>
      </section>
      {/* =====================================================
          FAULT ANALYSIS
      ===================================================== */}

      <section className="mission-report__section">
        <div className="mission-report__section-head">
          <div>
            <h3>Fault Analysis</h3>

            <p>
              One row per fault episode. The detector often
              flags a fault as Unknown Anomaly before a rule
              can name it; that lead time is the early warning.
            </p>
          </div>
        </div>

        {faultLoading ? (
          <p className="mission-report__message">
            Loading fault data...
          </p>
        ) : faultError ? (
          <p className="mission-report__error">
            {faultError}
          </p>
        ) : faults.length === 0 ? (
          <p className="mission-report__message">
            No recorded faults found.
          </p>
        ) : (
          <div className="mission-report__table-wrap">

            <table className="mission-report__table">
              <thead>
                <tr>
                  <th>Fault</th>
                  <th>Severity</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Early warning</th>
                </tr>
              </thead>

              <tbody>
                {faults.map((fault) => {
                  const severity = fault.severity ?? 'UNKNOWN'

                  return (
                    <tr key={`${fault.engine_id}-${fault.start}`}>
                      <td>
                        {formatFaultName(fault.fault_type)}
                      </td>

                      <td>
                        <span
                          className={`mission-report__severity mission-report__severity--${severity.toLowerCase()}`}
                        >
                          {severity}
                        </span>
                      </td>

                      <td>
                        {formatFaultTime(fault.start)}
                      </td>

                      <td>
                        {formatSeconds(fault.duration_seconds)}
                      </td>

                      <td>
                        {fault.early_warning_seconds > 0
                          ? `${formatSeconds(fault.early_warning_seconds)} before it was named`
                          : fault.fault_type === 'UNKNOWN_ANOMALY'
                            ? 'Never named by a rule'
                            : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="mission-rul-section">
      <div className="mission-rul-header">
        <h2>Degradation &amp; RUL Analysis</h2>

        <p>
          Engine wear and remaining useful life estimated from the
          digital twin's accumulated degradation history.
        </p>
      </div>

      {rulLoading ? (
        <div className="mission-rul-message">
          Loading degradation data...
        </div>
      ) : rulError ? (
        <div className="mission-rul-message mission-rul-message--error">
          {rulError}
        </div>
      ) : rulData ? (
        <>
          <div className="mission-rul-grid">

            <div className="mission-rul-card">
              <span className="mission-rul-label">
                CUMULATIVE WEAR
              </span>

              <strong className="mission-rul-value">
                {(
                  Number(rulData.cumulative_wear ?? 0) * 100
                ).toFixed(1)}
                %
              </strong>

              <span className="mission-rul-sub">
                Engine degradation state
              </span>
            </div>

            <div className="mission-rul-card">
              <span className="mission-rul-label">
                ENGINE LIFE REMAINING
              </span>

              <strong className="mission-rul-value">
                {rulData.rul?.remaining ?? 'Unavailable'}
              </strong>

              <span className="mission-rul-sub">
                Long-term RUL estimate
              </span>
            </div>

            <div className="mission-rul-card">
              <span className="mission-rul-label">
                ESTIMATED FLIGHTS
              </span>

              <strong className="mission-rul-value">
                {formatRulFlights(
                  rulData.rul?.flights,
                )}
              </strong>

              <span className="mission-rul-sub">
                Estimated remaining missions
              </span>
            </div>

            <div className="mission-rul-card">
              <span className="mission-rul-label">
                RUL RANGE
              </span>

              <strong className="mission-rul-value">
                {rulData.rul?.range ?? 'Unavailable'}
              </strong>

              <span className="mission-rul-sub">
                Estimated uncertainty range
              </span>
            </div>

            <div className="mission-rul-card">
              <span className="mission-rul-label">
                FLIGHTS LOGGED
              </span>

              <strong className="mission-rul-value">
                {Number(
                  rulData.flights_logged ?? 0,
                ).toLocaleString()}
              </strong>

              <span className="mission-rul-sub">
                Historical wear records
              </span>
            </div>

            <div className="mission-rul-card">
              <span className="mission-rul-label">
                RECENT DAMAGE / FLIGHT
              </span>

              <strong className="mission-rul-value">
                {rulData.recent_damage_per_flight != null
                  ? Number(
                      rulData.recent_damage_per_flight,
                    ).toFixed(5)
                  : '—'}
              </strong>

              <span className="mission-rul-sub">
                Recent degradation rate
              </span>
            </div>

          </div>

          {activeFault && activeFaultRul != null && (
            <div className="mission-rul-fault">
              <div>
                <span className="mission-rul-label">
                  ACTIVE FAULT — TIME UNTIL FULLY DEVELOPED
                </span>

                <strong>
                  {formatFaultName(activeFault.fault_type)}
                </strong>
              </div>

              <div className="mission-rul-fault-value">
                {Number(activeFaultRul).toFixed(1)}
                s
              </div>
            </div>
          )}

          <div className="mission-rul-summary">
            {rulData.rul?.summary ??
              'No long-term RUL summary is available.'}{' '}
            Estimated from the wear recorded over past flights;
            live telemetry does not add wear.
            {Number(rulData.flights_logged ?? 0) === 0 &&
              ' No flights have been recorded for this engine yet, so this is the default estimate for its current wear level.'}
          </div>
        </>
      ) : (
        <div className="mission-rul-message">
          No degradation data available.
        </div>
      )}
    </section>
      {/* =====================================================
          TELEMETRY ANALYSIS
      ===================================================== */}

      <section className="mission-report__section">
        <div className="mission-report__section-head">
          <div>
            <h3>Telemetry Analysis</h3>

            <p>
              Minimum, average and maximum values recorded
              during the mission.
            </p>
          </div>
        </div>

        <div className="mission-fault-box">
          <div className="mission-report__table-wrap">
            <table className="mission-report__table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Minimum</th>
                <th>Average</th>
                <th>Maximum</th>
                <th>Unit</th>
              </tr>
            </thead>

            <tbody>
              {Object.entries(report.statistics).map(
                ([key, stats]) => (
                  <tr key={key}>
                    <td>
                      {SENSOR_LABELS[key] ?? key}
                    </td>

                    <td>
                      {formatNumber(stats.min, SENSOR_DIGITS[key])}
                    </td>

                    <td>
                      {formatNumber(stats.average, SENSOR_DIGITS[key])}
                    </td>

                    <td>
                      {formatNumber(stats.max, SENSOR_DIGITS[key])}
                    </td>

                    <td>
                      {sensorUnit[key] ?? '—'}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          </div>
        </div>
      </section>
            {/* =====================================================
          MAINTENANCE SUMMARY
      ===================================================== */}

      <section className="mission-report__section">
        <div className="mission-report__section-head">
          <div>
            <h3>Maintenance Summary</h3>

            <p>
              Maintenance actions derived from the health and
              fault condition observed during this mission.
            </p>
          </div>
        </div>

        <div className="mission-maintenance-grid">
          <div className="mission-maintenance-card">
            <span>CRITICAL FAULTS</span>

            <strong>
              {severityCounts.critical}
            </strong>
          </div>

          <div className="mission-maintenance-card">
            <span>HIGH-SEVERITY FAULTS</span>

            <strong>
              {severityCounts.high}
            </strong>
          </div>

          <div className="mission-maintenance-card">
            <span>FAULT EPISODES</span>

            <strong>
              {faults.length}
            </strong>
          </div>

          <div className="mission-maintenance-card">
            <span>PRIMARY CONCERN</span>

            <strong>
              {primaryFaultName}
            </strong>
          </div>
        </div>

        <div className="mission-maintenance-action">
          <div>
            <span>Maintenance Status</span>

            <strong>
              {maintenanceStatus}
            </strong>
          </div>

          <p>
            {maintenanceAction}
          </p>
        </div>
      </section>

      {/* =====================================================
          MISSION CONCLUSION
      ===================================================== */}

      <section className="mission-report__section">
        <div className="mission-report__section-head">
          <div>
            <h3>Mission Conclusion</h3>

            <p>
              Final assessment based on the selected mission
              telemetry, detected faults, engine health and RUL.
            </p>
          </div>
        </div>

        <div className="mission-conclusion">
          <div className="mission-conclusion__status">
            <span>MISSION HEALTH STATUS</span>

            <strong>
              {healthStatus(engineStatus)}
            </strong>
          </div>

          <p className="mission-conclusion__text">
            {conclusionText}
          </p>

          <div className="mission-conclusion__details">
            <div>
              <span>Lowest Health</span>

              <strong>
                {healthPercent(engine)}
              </strong>
            </div>

            <div>
              <span>Primary Concern</span>

              <strong>
                {primaryFaultName}
              </strong>
            </div>

            <div>
              <span>Long-term RUL</span>

              <strong>
                {rulData?.rul?.remaining ?? 'Unavailable'}
              </strong>
            </div>
          </div>
        </div>
      </section>
    </section>
  )
}