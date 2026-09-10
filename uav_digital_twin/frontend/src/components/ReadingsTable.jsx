import { SENSORS, STATUS_META, sensorStatus } from '../config/sensors.js'
import { formatClock, formatValue } from '../lib/format.js'

const MAX_ROWS = 60

// Table view of the same readings the charts plot, newest first.
export function ReadingsTable({ readings }) {
  const rows = readings.slice(-MAX_ROWS).reverse()

  return (
    <div className="table-wrap">
      <table className="readings">
        <thead>
          <tr>
            <th scope="col">Time</th>
            {SENSORS.map((s) => (
              <th key={s.key} scope="col">
                {s.code}
                <span className="readings__unit">{s.unit}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.time}>
              <th scope="row">{formatClock(r.timestamp)}</th>
              {SENSORS.map((s) => {
                const value = r.values[s.key]
                const status = sensorStatus(s, value)
                const flagged = status === 'warning' || status === 'critical'
                return (
                  <td key={s.key} className={`readings__cell readings__cell--${status}`}>
                    {formatValue(s, value)}
                    {flagged && <span className="sr-only"> ({STATUS_META[status].label})</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
