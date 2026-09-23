import { useMemo, useState } from 'react'
import { StatusLight } from '../components/StatusLight.jsx'
import { PART_BY_ID } from '../config/engineParts.js'
import { SEVERITY_META, faultTitle } from '../config/faults.js'
import { formatValue } from '../lib/format.js'
import { healthFor, overallHealth, worstPart } from '../lib/health.js'
import './EngineSimulation.css'

// Inline four, drawn as a cutaway: bore centre, piston crown height and the
// crank pin it hangs off, so every piston sits at a believable point in its stroke.
const CYLINDERS = [
  { x: 434, piston: 150, pin: [0, -18] },
  { x: 506, piston: 198, pin: [15, 11] },
  { x: 578, piston: 166, pin: [-15, -10] },
  { x: 650, piston: 212, pin: [0, 18] },
]

const CRANK_Y = 300
const JOURNALS = [398, 470, 542, 614, 686]
const FINS = Array.from({ length: 11 }, (_, i) => 136 + i * 10)

const pct = (health) => (health == null ? '—' : `${Math.round(health * 100)}%`)

// One clickable part of the engine. Outline colour and percentage come from lib/health.js.
function Part({ id, health, selected, onSelect, children }) {
  const info = health[id] ?? { status: 'nodata', health: null }
  const part = PART_BY_ID[id]

  return (
    <g
      className={`part part--${info.status}${selected === id ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${part.label}, health ${pct(info.health)}`}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(id)
        }
      }}
    >
      <title>{`${part.label} — ${pct(info.health)}`}</title>
      {children}
    </g>
  )
}

// Name + percentage on a small plate, with an optional leader line to the part,
// so labels never get lost in the drawing.
function Label({ x, y, id, health, anchor = 'middle', leader }) {
  const part = PART_BY_ID[id]
  const text = part.short ?? part.label
  const top = Number(y)
  const left = Number(x)
  const textWidth = Math.max(text.length * 7, 44)
  const width = textWidth + 22
  const plateX = anchor === 'middle' ? left - width / 2 : anchor === 'end' ? left - textWidth - 11 : left - 11

  return (
    <g className="part__label" textAnchor={anchor}>
      {leader && <path className="part__leader" d={leader} />}
      <rect className="part__plate" x={plateX} y={top - 16} width={width} height={42} rx={9} />
      <text className="part__name" x={x} y={top}>
        {text}
      </text>
      <text className="part__pct" x={x} y={top + 20}>
        {pct(health[id]?.health)}
      </text>
    </g>
  )
}

export function EngineSimulation({ telemetry, stale, alerts }) {
  const { latest } = telemetry
  const [selected, setSelected] = useState('cylinders')

  const health = useMemo(
    () => healthFor({ latest, stale, alerts: alerts.items }),
    [latest, stale, alerts.items],
  )

  const engine = overallHealth(health)
  const worst = worstPart(health)
  const usesModel = Object.keys(latest?.fault?.deviation ?? {}).length > 0
  const flaggedBy = latest?.fault?.flagged_by ?? []
  const part = PART_BY_ID[selected]
  const info = health[selected] ?? { status: 'nodata', health: null, sensors: [], faults: [] }
  const common = { health, selected, onSelect: setSelected }

  return (
    <div className={`sim${stale ? ' sim--stale' : ''}`}>
      <section className="card sim__stage" aria-label="Engine schematic">
        <header className="sim__head">
          <div className="sim__score">
            <span className="sim__score-label">Engine health</span>
            <span className="sim__score-value">{pct(engine)}</span>
            <StatusLight status={worst?.status ?? 'nodata'} />
          </div>
          <p className="sim__note">
            {stale
              ? 'No live readings — the schematic shows the last known state.'
              : usesModel
                ? 'Part health from sensor limits and how far each sensor sits from the value the model expects.'
                : 'Part health from sensor limits only (per-sensor deviations need detector v2).'}
          </p>
          <ul className="sim__legend">
            <li className="sim__legend-item sim__legend-item--normal">Healthy</li>
            <li className="sim__legend-item sim__legend-item--warning">Degraded</li>
            <li className="sim__legend-item sim__legend-item--critical">At risk</li>
          </ul>
        </header>

        <svg className="sim__svg" viewBox="0 0 1000 510" role="img" aria-label="Engine cutaway with per-part health">
          <defs>
            <pattern id="sim-grid" width="26" height="26" patternUnits="userSpaceOnUse">
              <path d="M26 0H0V26" />
            </pattern>
          </defs>
          <rect className="sim__grid" x="0" y="0" width="1000" height="510" fill="url(#sim-grid)" />

          {/* ---------- cooling air: duct into the cylinder fins ---------- */}
          <Part id="cooling" {...common}>
            <path className="part__shape" d="M250 134L352 150V194L250 214Z" />
            <path
              className="part__detail"
              d="M278 154H330M322 150l9 4-9 4M278 170H330M322 166l9 4-9 4M278 188H330M322 184l9 4-9 4"
            />
            {FINS.map((y) => (
              <path key={y} className="part__fin" d={`M352 ${y}H376`} />
            ))}
            <Label x="160" y="174" id="cooling" health={health} leader="M212 174H250" />
          </Part>

          {/* ---------- fuel: tank -> pump -> rail -> injectors ---------- */}
          <Part id="fuel_tank" {...common}>
            <rect className="part__shape" x="34" y="44" width="160" height="66" rx="14" />
            <path className="part__detail" d="M58 102h124M104 40v-8h22v8" />
            <Label x="116" y="70" id="fuel_tank" health={health} />
          </Part>

          <Part id="fuel_pump" {...common}>
            <path className="part__pipe part__pipe--flow" d="M200 70H220" />
            <circle className="part__shape" cx="238" cy="73" r="20" />
            <path className="part__detail" d="M238 59v28M224 73h28" />
            <Label x="244" y="22" id="fuel_pump" health={health} leader="M250 42V53" />
          </Part>

          <Part id="injectors" {...common}>
            <path className="part__pipe part__pipe--flow" d="M266 68H700" />
            {CYLINDERS.map((c) => (
              <g key={c.x}>
                <path className="part__pipe part__pipe--thin" d={`M${c.x - 14} 73V82`} />
                <rect className="part__shape" x={c.x - 20} y="88" width="12" height="20" rx="3" />
              </g>
            ))}
            <Label x="730" y="50" id="injectors" health={health} anchor="start" leader="M714 58L700 73" />
          </Part>

          {/* ---------- spark plugs ---------- */}
          <Part id="combustion" {...common}>
            {CYLINDERS.map((c) => (
              <g key={c.x}>
                <rect className="part__shape" x={c.x + 8} y="86" width="13" height="18" rx="3" />
                <path className="part__detail" d={`M${c.x + 14} 104v12`} />
              </g>
            ))}
            <Label x="734" y="112" id="combustion" health={health} anchor="start" leader="M724 112H666" />
          </Part>

          {/* ---------- block, heads, pistons ---------- */}
          <Part id="cylinders" {...common}>
            <path className="part__shape" d="M376 80H704V250H376Z" />
            {CYLINDERS.map((c) => (
              <g key={c.x}>
                <rect className="part__shape" x={c.x - 30} y="100" width="60" height="28" rx="4" />
                <rect className="part__shape" x={c.x - 27} y="128" width="54" height="122" />
                <path className="part__detail" d={`M${c.x - 22} 132V246M${c.x + 22} 132V246`} />
                <rect className="part__shape" x={c.x - 22} y={c.piston} width="44" height="14" rx="2" />
                <path className="part__detail" d={`M${c.x - 22} ${c.piston + 18}h44M${c.x - 22} ${c.piston + 23}h44`} />
                <path className="part__shape" d={`M${c.x - 20} ${c.piston + 14}h40v18h-40z`} />
              </g>
            ))}
            <Label x="734" y="214" id="cylinders" health={health} anchor="start" leader="M744 214H680" />
          </Part>

          {/* ---------- exhaust ---------- */}
          <Part id="exhaust" {...common}>
            <path className="part__pipe part__pipe--fat" d="M713 176H815" />
            <rect className="part__shape" x="824" y="156" width="128" height="40" rx="10" />
            <path className="part__detail" d="M852 162v28M876 162v28M900 162v28M924 162v28" />
            <Label x="888" y="230" id="exhaust" health={health} leader="M888 214V198" />
          </Part>

          {/* ---------- crankshaft: webs, journals, con-rods ---------- */}
          <Part id="crankcase" {...common}>
            <path className="part__shape" d="M376 250H704V338H376Z" />
            {JOURNALS.map((x) => (
              <circle key={x} className="part__shape" cx={x} cy={CRANK_Y} r="13" />
            ))}
            {CYLINDERS.map((c) => (
              <g key={c.x}>
                <circle className="part__shape" cx={c.x} cy={CRANK_Y} r="27" />
                <path
                  className="part__rod"
                  d={`M${c.x} ${c.piston + 22}L${c.x + c.pin[0]} ${CRANK_Y + c.pin[1]}`}
                />
                <circle className="part__detail-dot" cx={c.x + c.pin[0]} cy={CRANK_Y + c.pin[1]} r="7" />
              </g>
            ))}
            <rect className="part__shape" x="340" y="288" width="36" height="24" rx="4" />
            <circle className="part__shape" cx="706" cy={CRANK_Y} r="16" />
            <Label x="372" y="368" id="crankcase" health={health} leader="M372 352L392 322" />
          </Part>

          <Part id="mounts" {...common}>
            <path className="part__shape" d="M358 278h18v44h-18zM704 278h18v48h-18z" />
            <circle className="part__detail-dot" cx="367" cy="290" r="4" />
            <circle className="part__detail-dot" cx="713" cy="290" r="4" />
            <Label x="290" y="238" id="mounts" health={health} leader="M348 238L360 274" />
          </Part>

          {/* ---------- propeller and reduction drive ---------- */}
          <Part id="propeller" {...common}>
            <g className="sim__blades">
              {[0, 120, 240].map((angle) => (
                <path
                  key={angle}
                  className="part__shape"
                  d="M170 300L158 234Q170 216 182 234Z"
                  transform={`rotate(${angle} 170 300)`}
                />
              ))}
            </g>
            <circle className="part__shape" cx="170" cy="300" r="18" />
            <path className="part__pipe part__pipe--thin" d="M188 300H250" />
            <Label x="140" y="392" id="propeller" health={health} leader="M140 376V330" />
          </Part>

          <Part id="gearbox" {...common}>
            <rect className="part__shape" x="250" y="268" width="80" height="64" rx="8" />
            <circle className="part__detail-dot" cx="278" cy="300" r="15" />
            <circle className="part__detail-dot" cx="308" cy="300" r="9" />
            <path className="part__pipe part__pipe--thin" d="M330 300H340" />
            <Label x="274" y="424" id="gearbox" health={health} leader="M284 406V334" />
          </Part>

          {/* ---------- oil: sump -> pump -> cooler ---------- */}
          <Part id="oil_sump" {...common}>
            <path className="part__shape" d="M420 340H660L640 394H440Z" />
            <path className="part__detail" d="M454 388h176" />
            <Label x="540" y="360" id="oil_sump" health={health} />
          </Part>

          <Part id="oil_pump" {...common}>
            <path className="part__pipe part__pipe--flow" d="M650 380H700l20 14" />
            <circle className="part__shape" cx="740" cy="414" r="21" />
            <path className="part__detail" d="M740 398v32M724 414h32" />
            <Label x="740" y="474" id="oil_pump" health={health} leader="M740 458V432" />
          </Part>

          <Part id="oil_cooler" {...common}>
            <path className="part__pipe part__pipe--flow" d="M766 414H800" />
            <rect className="part__shape" x="800" y="388" width="150" height="56" rx="10" />
            <path className="part__detail" d="M816 396v40M824 396v40M876 396v40M926 396v40M934 396v40" />
            <Label x="875" y="412" id="oil_cooler" health={health} />
          </Part>

          {/* ---------- electrical ---------- */}
          <Part id="alternator" {...common}>
            <path className="part__pipe part__pipe--thin" d="M700 282L790 270M706 316L790 322" />
            <circle className="part__shape" cx="804" cy="296" r="30" />
            <circle className="part__detail-dot" cx="804" cy="296" r="12" />
            <Label x="804" y="352" id="alternator" health={health} leader="M804 336V326" />
          </Part>

          <Part id="battery" {...common}>
            <rect className="part__shape" x="866" y="280" width="120" height="56" rx="8" />
            <path className="part__detail" d="M882 280v-8h12v8M946 280v-8h12v8" />
            <Label x="924" y="304" id="battery" health={health} />
          </Part>
        </svg>
      </section>

      <aside className="card sim__detail" aria-label="Selected part">
        <header className="sim__detail-head">
          <div>
            <h2 className="sim__detail-title">{part.label}</h2>
            <StatusLight status={info.status} />
          </div>
          <span className={`sim__detail-pct sim__detail-pct--${info.status}`}>{pct(info.health)}</span>
        </header>

        <p className="sim__blurb">{part.blurb}</p>

        <h3 className="sim__sub">Readings behind it</h3>
        <ul className="sim__sensors">
          {info.sensors.length === 0 && <li className="sim__empty">Waiting for a live reading.</li>}
          {info.sensors.map((s) => (
            <li key={s.key} className={`sim__sensor sim__sensor--${s.status}`}>
              <span className="sim__sensor-name">{s.sensor.label}</span>
              <span className="sim__sensor-value">
                {formatValue(s.sensor, s.value)}
                <span className="sim__sensor-unit">{s.sensor.unit}</span>
              </span>
              <span className="sim__sensor-dev">
                {s.z == null ? 'no model' : `${s.z > 0 ? '+' : ''}${s.z.toFixed(1)} σ from expected`}
              </span>
            </li>
          ))}
        </ul>

        {info.faults.length > 0 && (
          <>
            <h3 className="sim__sub">Active faults here</h3>
            <ul className="sim__faults">
              {info.faults.map((fault) => (
                <li
                  key={fault.id}
                  className={`sim__fault sim__fault--${SEVERITY_META[fault.severity]?.tone ?? 'serious'}`}
                >
                  <strong>{faultTitle(fault.fault_type)}</strong>
                  <span>{fault.description}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {flaggedBy.length > 0 && (
          <p className="sim__flagged">Latest reading flagged by {flaggedBy.map((f) => f.replace(/_/g, ' ')).join(', ')}</p>
        )}

        <h3 className="sim__sub">Worst part right now</h3>
        <div className="sim__worst">
          {worst ? (
            <button type="button" className="btn btn--sm" onClick={() => setSelected(worst.id)}>
              {PART_BY_ID[worst.id].label} · {pct(worst.health)}
            </button>
          ) : (
            <span className="sim__empty">No readings yet.</span>
          )}
        </div>
      </aside>
    </div>
  )
}
