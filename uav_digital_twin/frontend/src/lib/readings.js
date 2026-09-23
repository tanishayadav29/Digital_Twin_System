// Turning what the backend sends into the reading shape the dashboard uses.
// Shared by the live stream (hooks/useTelemetry.js) and history replay
// (hooks/useReplay.js) so the two can never drift apart.
import { SENSORS } from '../config/sensors.js'

// The simulator sends UTC. Some DB drivers hand it back without a zone
// ("2026-09-10T14:46:12"), which the browser would read as local time.
export function withZone(timestamp) {
  if (typeof timestamp !== 'string') return timestamp
  return /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(timestamp) ? timestamp : `${timestamp}Z`
}

// Accepts both shapes the backend produces:
//   WebSocket / simulator / GET /sensor-history: { engine_id, timestamp, rpm, cht, ... }
//   GET /latest-sensor-data:                     { id, engine_id, timestamp, sensors: { rpm, cht, ... } }
// receivedAt is when this browser got the reading live; 0 = loaded from the database.
export function normalize(msg, receivedAt) {
  const timestamp = withZone(msg?.timestamp)
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) return null
  const src = msg.sensors ?? msg
  const values = {}
  for (const { key } of SENSORS) values[key] = typeof src[key] === 'number' ? src[key] : null
  // fault = the detector's result for this reading (live stream only; database rows have none)
  return { engineId: msg.engine_id ?? null, timestamp, time, receivedAt, values, fault: msg.fault ?? null }
}
