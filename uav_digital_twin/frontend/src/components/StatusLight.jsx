import { STATUS_META } from '../config/sensors.js'

export function StatusLight({ status, large = false }) {
  return (
    <span className={`light light--${status}${large ? ' light--lg' : ''}`}>
      <span className="light__dot" aria-hidden="true" />
      {STATUS_META[status].label}
    </span>
  )
}
