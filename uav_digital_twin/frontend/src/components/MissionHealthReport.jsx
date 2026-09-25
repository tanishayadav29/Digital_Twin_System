import {
  SENSOR_LABELS,
  formatDuration,
  missionReadings,
} from '../lib/missionReport.js'

import { PART_BY_ID } from '../config/engineParts.js'
import { healthFor, overallHealth, worstPart } from '../lib/health.js'

import './MissionHealthReport.css'
import { useEffect, useState } from 'react'
import { API_BASE } from '../config/app.js'

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

const getFaultSeverity = (fault) => {
  const severities = fault.severities ?? []

  if (severities.includes('CRITICAL')) {
    return 'CRITICAL'
  }

  if (severities.includes('HIGH')) {
    return 'HIGH'
  }

  if (severities.includes('MEDIUM')) {
    return 'MEDIUM'
  }

  if (severities.includes('LOW')) {
    return 'LOW'
  }

  return 'UNKNOWN'
}

const formatFaultTime = (value) => {
  if (!value) return 'N/A'

  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? 'N/A'
    : date.toLocaleString()
}

const formatRul = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  return `${value.toFixed(1)} s`
}

export function MissionHealthReport({
  readings = [],
  summary = null,
}) {
  const report = missionReadings(readings)
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
      setFaultLoading(true)
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
        setFaults(
          Array.isArray(data.faults)
            ? data.faults
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
}, [readings[0]?.engineId, readings[0]?.time])

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

const latestFaultWithRul = faults.reduce(
  (latest, fault) => {
    if (
      fault.latest_rul_seconds == null ||
      !fault.last_seen
    ) {
      return latest
    }

    if (!latest) {
      return fault
    }

    return new Date(fault.last_seen) >
      new Date(latest.last_seen)
      ? fault
      : latest
  },
  null,
)

  /*
   * Convert the replay reading into the same "latest" structure
   * already used by the existing Engine Simulation health system.
   */
  const latestReading = readings[readings.length - 1] ?? null

  const latest = latestReading
    ? {
        time: latestReading.time,
        engineId: latestReading.engineId,
        values: latestReading.values ?? {},
        fault: latestReading.fault ?? {},
      }
    : null

  /*
   * Reuse the existing health calculation.
   *
   * Replay does not currently pass live alerts into this report,
   * so the health calculation here is based on the telemetry
   * available in the selected mission recording.
   */
  const health = healthFor({
    latest,
    stale: readings.length === 0,
    alerts: [],
  })

  const engine = overallHealth(health)
  const worst = worstPart(health)

  const worstPartLabel =
    worst?.id && PART_BY_ID[worst.id]
      ? PART_BY_ID[worst.id].label
      : worst?.id ?? 'N/A'

  const engineStatus = worst?.status ?? 'nodata'

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
const severityRank = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
}

const severityCounts = faults.reduce(
  (counts, fault) => {
    const severity = getFaultSeverity(fault)

    if (severity === 'CRITICAL') {
      counts.critical += 1
    } else if (severity === 'HIGH') {
      counts.high += 1
    } else if (severity === 'MEDIUM') {
      counts.medium += 1
    } else if (severity === 'LOW') {
      counts.low += 1
    }

    return counts
  },
  {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  },
)

const primaryFault = [...faults].sort(
  (a, b) => {
    const severityDifference =
      severityRank[getFaultSeverity(b)] -
      severityRank[getFaultSeverity(a)]

    if (severityDifference !== 0) {
      return severityDifference
    }

    return Number(b.count ?? 0) - Number(a.count ?? 0)
  },
)[0] ?? null

const primaryFaultName = primaryFault
  ? formatFaultName(primaryFault.fault_type)
  : 'No significant fault detected'

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

const conclusionText =
  engineStatus === 'critical'
    ? `The mission telemetry indicates a critical engine condition. The primary recorded concern was ${primaryFaultName}. The observed health state and degradation indicators should be reviewed before the next mission.`
    : engineStatus === 'warning'
      ? `The mission completed with warning-level engine conditions. The primary recorded concern was ${primaryFaultName}. Continued monitoring and scheduled inspection are recommended.`
      : faults.length > 0
        ? `The mission completed with recorded fault activity, but the selected telemetry remains within a generally acceptable health state. Continued monitoring of ${primaryFaultName} is recommended.`
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
            Historical engine telemetry analysis for the
            selected replay window.
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
              Overall engine condition calculated from the
              selected mission telemetry.
            </p>
          </div>
        </div>

        <div className="mission-report__health">
          <div className="mission-report__health-main">
            <span>Overall health</span>

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
              Recorded engine faults, severity, occurrences,
              and latest remaining useful life estimates.
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
                  <th>Occurrences</th>
                  <th>Last Detected</th>
                  <th>Latest RUL</th>
                </tr>
              </thead>

              <tbody>
                {faults.map((fault) => {
                  const severity = getFaultSeverity(fault)

                  return (
                    <tr key={fault.fault_type}>
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
                        {Number(fault.count ?? 0).toLocaleString()}
                      </td>

                      <td>
                        {formatFaultTime(fault.last_seen)}
                      </td>

                      <td>
                        {formatRul(fault.latest_rul_seconds)}
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

          {latestFaultWithRul && (
            <div className="mission-rul-fault">
              <div>
                <span className="mission-rul-label">
                  LATEST FAULT RUL
                </span>

                <strong>
                  {latestFaultWithRul.fault_type.replaceAll(
                    '_',
                    ' ',
                  )}
                </strong>
              </div>

              <div className="mission-rul-fault-value">
                {Number(
                  latestFaultWithRul.latest_rul_seconds,
                ).toFixed(1)}
                s
              </div>
            </div>
          )}

          <div className="mission-rul-summary">
            {rulData.rul?.summary ??
              'No long-term RUL summary is available.'}
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
                      {formatNumber(stats.min)}
                    </td>

                    <td>
                      {formatNumber(stats.average)}
                    </td>

                    <td>
                      {formatNumber(stats.max)}
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
            <span>TOTAL FAULT TYPES</span>

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
              <span>Overall Health</span>

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