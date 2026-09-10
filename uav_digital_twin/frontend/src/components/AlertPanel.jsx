import { useState } from 'react'
import { ALERTS_FROM_BACKEND } from '../config/app.js'
import { FAULT_TYPES, SEVERITY_META, faultTitle } from '../config/faults.js'
import { SENSOR_BY_KEY } from '../config/sensors.js'
import { formatClock } from '../lib/format.js'

export function AlertPanel({ alerts }) {
  const { items, trigger, acknowledge, acknowledgeAll, clear } = alerts
  const [faultType, setFaultType] = useState(FAULT_TYPES[0].type)
  const activeCount = items.filter((a) => !a.acknowledged).length
  const alarm = activeCount > 0

  return (
    <aside
      id="alert-panel"
      className={`card alerts ${alarm ? 'alerts--alarm' : 'alerts--quiet'}`}
      aria-label="Anomaly alerts"
    >
      <header className="alerts__head">
        <div>
          <h2 className="alerts__title">Anomaly alerts</h2>
          <p className="alerts__sub">
            ML detector · {ALERTS_FROM_BACKEND ? 'connected' : 'not connected'}
          </p>
        </div>
        <span className={`pill ${alarm ? 'pill--alarm' : 'pill--quiet'}`}>
          <span className="pill__dot" aria-hidden="true" />
          {alarm ? `${activeCount} active` : 'Monitoring'}
        </span>
      </header>

      <div className="alerts__body" aria-live="polite">
        {items.length === 0 ? (
          <div className="alerts__empty">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                d="M12 2.8 4.5 5.6v5.9c0 4.6 3.1 8.6 7.5 9.7 4.4-1.1 7.5-5.1 7.5-9.7V5.6L12 2.8Z"
              />
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m8.6 12.2 2.4 2.4 4.6-4.9"
              />
            </svg>
            <strong>All quiet</strong>
            <span>Alerts appear here the moment the detector flags an unusual window.</span>
          </div>
        ) : (
          <ol className="alerts__list">
            {items.map((alert) => (
              <AlertItem key={alert.id} alert={alert} onAcknowledge={acknowledge} />
            ))}
          </ol>
        )}
      </div>

      <footer className="alerts__foot">
        <div className="alerts__foot-label">
          <span>Test trigger</span>
          <span>Until the ML model is wired in</span>
        </div>
        <div className="row">
          <select
            className="select"
            value={faultType}
            onChange={(e) => setFaultType(e.target.value)}
            aria-label="Fault type to simulate"
          >
            {FAULT_TYPES.map((f) => (
              <option key={f.type} value={f.type}>
                {f.title}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--danger" onClick={() => trigger(faultType)}>
            Trigger anomaly
          </button>
        </div>
        {items.length > 0 && (
          <div className="row row--end">
            <button type="button" className="btn btn--ghost btn--sm" onClick={acknowledgeAll} disabled={!alarm}>
              Acknowledge all
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={clear}>
              Clear log
            </button>
          </div>
        )}
      </footer>
    </aside>
  )
}

function AlertItem({ alert, onAcknowledge }) {
  const severity = SEVERITY_META[alert.severity] ?? SEVERITY_META.HIGH

  return (
    <li className={`alert alert--${severity.tone}${alert.acknowledged ? ' is-acked' : ''}`}>
      <p className="alert__line">
        <time className="alert__time" dateTime={alert.timestamp}>
          {formatClock(alert.timestamp)}
        </time>
        <span aria-hidden="true">—</span>
        <span>{alert.description}</span>
      </p>
      <div className="alert__meta">
        <span className="sev">{severity.label}</span>
        <span>{faultTitle(alert.fault_type)}</span>
        {alert.confidence != null && <span>{Math.round(alert.confidence * 100)}% confidence</span>}
      </div>
      <div className="alert__foot">
        <div className="chips">
          {alert.sensors.map((key) => (
            <span key={key} className="chip">
              {SENSOR_BY_KEY[key]?.code ?? key}
            </span>
          ))}
          {alert.source === 'manual' && <span className="chip chip--muted">Test</span>}
        </div>
        {alert.acknowledged ? (
          <span className="alert__acked">Acknowledged</span>
        ) : (
          <button type="button" className="btn btn--sm" onClick={() => onAcknowledge(alert.id)}>
            Acknowledge
          </button>
        )}
      </div>
    </li>
  )
}
