export function ConnectionBadge({ source, link, transport, stale, lastReceivedAt, now }) {
  let tone
  let label
  let detail

  if (source === 'simulator') {
    tone = 'info'
    label = 'Simulated'
    detail = 'In-browser generator'
  } else if (link === 'connecting') {
    tone = 'warning'
    label = 'Connecting'
    detail = 'Reaching backend…'
  } else if (link === 'offline') {
    tone = 'critical'
    label = 'Backend offline'
    detail = 'Retrying…'
  } else if (stale) {
    tone = 'warning'
    label = 'No data'
    detail = lastReceivedAt
      ? `Last reading ${Math.round((now - lastReceivedAt) / 1000)} s ago`
      : 'Is sensor_simulator.py running?'
  } else {
    tone = 'good'
    label = 'Live'
    detail = transport === 'websocket' ? 'WebSocket stream' : 'REST polling fallback'
  }

  return (
    <div className={`badge badge--${tone}`} role="status">
      <span className="badge__dot" aria-hidden="true" />
      <span className="badge__label">{label}</span>
      <span className="badge__detail">{detail}</span>
    </div>
  )
}
