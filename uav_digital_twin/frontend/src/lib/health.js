// Health of each engine part, worked out from the latest reading.
//
// Two independent signals feed it:
//   limits    - how far a sensor is past its caution / alert limit (config/sensors.js)
//   deviation - how far the sensor sits from the value the model expects at this RPM,
//               in standard deviations (model v2 only; see ML/fault_detector_v2.py)
// An active alert whose fault type maps to the part caps its health as well.
import { ENGINE_PARTS } from '../config/engineParts.js'
import { SENSOR_BY_KEY, sensorStatus } from '../config/sensors.js'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// 0 = inside the normal band, 1 = at the alert limit, >1 = past it
export function exceedance(sensor, value) {
  if (value == null || !Number.isFinite(value)) return null
  const { critLow, warnLow, warnHigh, critHigh } = sensor.limits
  const fallback = (sensor.max - sensor.min) * 0.1
  if (warnHigh != null && value > warnHigh) {
    return (value - warnHigh) / (critHigh != null ? critHigh - warnHigh : fallback)
  }
  if (warnLow != null && value < warnLow) {
    return (warnLow - value) / (critLow != null ? warnLow - critLow : fallback)
  }
  return 0
}

// 1 inside the normal band, 0.5 at the alert limit, then down to a floor
function limitHealth(sensor, value) {
  const past = exceedance(sensor, value)
  if (past == null) return null
  return clamp(1 - 0.5 * Math.min(past, 1) - 0.3 * clamp(past - 1, 0, 1), 0.1, 1)
}

// Deviations under 3 std are normal scatter; 15 std is a clear fault
function deviationHealth(z) {
  if (z == null || !Number.isFinite(z)) return null
  const off = Math.abs(z)
  if (off <= 3) return 1
  return clamp(1 - 0.6 * Math.min((off - 3) / 12, 1) - 0.25 * clamp((off - 15) / 20, 0, 1), 0.1, 1)
}

const SEVERITY_CAP = { MEDIUM: 0.7, HIGH: 0.5, CRITICAL: 0.3 }
// An alert stops holding a part down once its readings have been clean this long,
// so a part recovers on screen even while the alert is still unacknowledged.
const FAULT_MEMORY_MS = 60_000

export function healthFor({ latest, stale, alerts = [] }) {
  const deviation = latest?.fault?.deviation ?? {}
  const since = (latest?.time ?? Date.now()) - FAULT_MEMORY_MS
  const active = alerts.filter(
    (a) => !a.acknowledged && Date.parse(a.lastTimestamp ?? a.timestamp) >= since,
  )

  return Object.fromEntries(
    ENGINE_PARTS.map((part) => {
      if (stale || !latest) {
        return [part.id, { health: null, status: 'nodata', sensors: [], faults: [] }]
      }

      const sensors = part.sensors.map((key) => {
        const sensor = SENSOR_BY_KEY[key]
        const value = latest.values[key]
        const z = typeof deviation[key] === 'number' ? deviation[key] : null
        const fromLimits = limitHealth(sensor, value)
        const fromModel = deviationHealth(z)
        return {
          key,
          sensor,
          value,
          z,
          status: sensorStatus(sensor, value),
          health: Math.min(fromLimits ?? 0.6, fromModel ?? 1),
        }
      })

      const faults = active.filter((a) => part.faults.includes(a.fault_type))
      let health = Math.min(...sensors.map((s) => s.health))
      for (const fault of faults) health = Math.min(health, SEVERITY_CAP[fault.severity] ?? 0.6)

      const missing = sensors.some((s) => s.value == null)
      const status = missing ? 'nodata' : health >= 0.85 ? 'normal' : health >= 0.6 ? 'warning' : 'critical'

      return [part.id, { health, status, sensors, faults }]
    }),
  )
}

// One number for the whole engine: the average part, pulled down by its worst
export function overallHealth(health) {
  const values = Object.values(health)
    .map((p) => p.health)
    .filter((v) => v != null)
  if (!values.length) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return (mean + Math.min(...values)) / 2
}

export function worstPart(health) {
  let worst = null
  for (const [id, part] of Object.entries(health)) {
    if (part.health == null) continue
    if (!worst || part.health < worst.health) worst = { id, ...part }
  }
  return worst
}
