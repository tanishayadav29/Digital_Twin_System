import { sensorZones } from '../config/sensors.js'
import { formatValue } from '../lib/format.js'

// 240° dial: -120° is the minimum (lower left), +120° the maximum (lower right),
// 0° points straight up.
const SWEEP_START = -120
const SWEEP_END = 120
const CX = 100
const CY = 96 // keep in sync with .gauge__needle transform-origin in styles.css
const R = 74 // value track
const ZONE_R = 88 // coloured limit bands
const ZONE_GAP = 0.9 // degrees of surface gap between bands
const TICKS = Array.from({ length: 11 }, (_, i) => SWEEP_START + i * 24)

function polar(r, deg) {
  const rad = (deg * Math.PI) / 180
  return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)]
}

function arc(r, from, to) {
  const [x1, y1] = polar(r, from)
  const [x2, y2] = polar(r, to)
  const largeArc = to - from > 180 ? 1 : 0
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

const TRACK = arc(R, SWEEP_START, SWEEP_END)

export function Gauge({ sensor, value, status }) {
  const { min, max } = sensor
  const angleOf = (v) => SWEEP_START + ((v - min) / (max - min)) * (SWEEP_END - SWEEP_START)
  const hasValue = value != null && Number.isFinite(value)
  const fraction = hasValue ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0
  const needleAngle = SWEEP_START + fraction * (SWEEP_END - SWEEP_START)
  const zones = sensorZones(sensor)
  const [minX, endY] = polar(R, SWEEP_START)
  const [maxX] = polar(R, SWEEP_END)
  const formatted = formatValue(sensor, value)

  return (
    <svg
      className={`gauge gauge--${status}`}
      viewBox="0 0 200 164"
      role="img"
      aria-label={`${sensor.label}: ${formatted} ${sensor.unit}`}
    >
      {zones.map((zone, i) => (
        <path
          key={zone.from}
          className={`gauge__zone gauge__zone--${zone.status}`}
          d={arc(
            ZONE_R,
            angleOf(zone.from) + (i > 0 ? ZONE_GAP : 0),
            angleOf(zone.to) - (i < zones.length - 1 ? ZONE_GAP : 0),
          )}
        />
      ))}

      <path className="gauge__track" d={TRACK} />
      <path
        className="gauge__fill"
        d={TRACK}
        pathLength="100"
        style={{ strokeDashoffset: 100 - fraction * 100 }}
      />

      {TICKS.map((deg) => {
        const [x1, y1] = polar(R - 12, deg)
        const [x2, y2] = polar(R - 17, deg)
        return <line key={deg} className="gauge__tick" x1={x1} y1={y1} x2={x2} y2={y2} />
      })}

      <g className="gauge__needle" style={{ transform: `rotate(${needleAngle}deg)` }}>
        <path d={`M${CX} ${CY - R + 8}L${CX + 3.2} ${CY}L${CX} ${CY + 12}L${CX - 3.2} ${CY}Z`} />
      </g>
      <circle className="gauge__hub" cx={CX} cy={CY} r="6.5" />

      <text className="gauge__value" x={CX} y={CY + 42} textAnchor="middle">
        {formatted}
      </text>
      <text className="gauge__unit" x={CX} y={CY + 58} textAnchor="middle">
        {sensor.unit}
      </text>
      <text className="gauge__limit" x={minX} y={endY + 20} textAnchor="middle">
        {min.toLocaleString('en-US')}
      </text>
      <text className="gauge__limit" x={maxX} y={endY + 20} textAnchor="middle">
        {max.toLocaleString('en-US')}
      </text>
    </svg>
  )
}
