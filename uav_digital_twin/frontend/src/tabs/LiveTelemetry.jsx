import { AlertPanel } from '../components/AlertPanel.jsx'
import { SensorCard } from '../components/SensorCard.jsx'
import { StatusLight } from '../components/StatusLight.jsx'
import { SENSORS, sensorStatus, worstStatus } from '../config/sensors.js'
import { formatClock } from '../lib/format.js'

const PRIMARY = SENSORS.filter((s) => s.primary)
const SECONDARY = SENSORS.filter((s) => !s.primary)

export function LiveTelemetry({ telemetry, stale, alerts }) {
  const { latest, history } = telemetry
  const valueOf = (sensor) => latest?.values[sensor.key] ?? null
  const statusOf = (sensor) => (stale ? 'nodata' : sensorStatus(sensor, valueOf(sensor)))

  const statuses = SENSORS.map(statusOf)
  const overall = worstStatus(statuses)
  const outOfLimits = statuses.filter((s) => s === 'warning' || s === 'critical').length
  const activeAlerts = alerts.items.filter((a) => !a.acknowledged)
  const flagged = new Set(activeAlerts.flatMap((a) => a.sensors))

  const renderCard = (sensor) => (
    <SensorCard
      key={sensor.key}
      sensor={sensor}
      value={valueOf(sensor)}
      status={statusOf(sensor)}
      history={history}
      flagged={flagged.has(sensor.key)}
    />
  )

  return (
    <div className="live">
      <div className="live__main">
        <section className="card summary" aria-label="Engine summary">
          <div className="stat">
            <span className="stat__label">Engine health</span>
            <span className="stat__value">
              <StatusLight status={overall} large />
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Parameters outside limits</span>
            <span className="stat__value">
              {stale ? '—' : outOfLimits}
              <span className="stat__unit">of {SENSORS.length}</span>
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Active alerts</span>
            <span className="stat__value">{activeAlerts.length}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Last reading</span>
            <span className="stat__value stat__value--clock">
              {latest ? formatClock(latest.timestamp) : '--:--:--'}
            </span>
          </div>
        </section>

        <section aria-labelledby="primary-title">
          <h2 id="primary-title" className="section-title">
            Primary engine parameters
          </h2>
          <div className="grid">{PRIMARY.map(renderCard)}</div>
        </section>

        <section aria-labelledby="secondary-title">
          <h2 id="secondary-title" className="section-title">
            Temperatures &amp; electrical
          </h2>
          <div className="grid">{SECONDARY.map(renderCard)}</div>
        </section>
      </div>

      <AlertPanel alerts={alerts} telemetry={telemetry} />
    </div>
  )
}
