import { memo } from 'react'
import { Gauge } from './Gauge.jsx'
import { Sparkline } from './Sparkline.jsx'
import { StatusLight } from './StatusLight.jsx'

export const SensorCard = memo(function SensorCard({ sensor, value, status, history, flagged }) {
  return (
    <article className={`card sensor sensor--${status}${flagged ? ' is-flagged' : ''}`}>
      <header className="sensor__head">
        <div className="sensor__row">
          <span className="sensor__code">{sensor.code}</span>
          <StatusLight status={status} />
        </div>
        <div className="sensor__row">
          <h3 className="sensor__label" title={sensor.label}>
            {sensor.label}
          </h3>
          {flagged && <span className="flag">Flagged</span>}
        </div>
      </header>
      <Gauge sensor={sensor} value={value} status={status} />
      <Sparkline sensor={sensor} history={history} status={status} />
    </article>
  )
})
