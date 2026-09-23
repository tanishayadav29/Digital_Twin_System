import { Suspense, lazy, useMemo, useState } from 'react'
import { StatusLight } from '../components/StatusLight.jsx'
import { PART_BY_ID } from '../config/engineParts.js'
import { ENGINE_3D_SOURCES, SPEC } from '../config/engine3d.js'
import { SEVERITY_META, faultTitle } from '../config/faults.js'
import { formatValue } from '../lib/format.js'
import { healthFor, overallHealth, worstPart } from '../lib/health.js'
import './EngineSimulation.css'

// three.js is only paid for if someone opens the 3D view.
const Engine3D = lazy(() => import('../components/engine3d/Engine3D.jsx'))

// Rotax 912 iS drawn in plan view - looking down on the engine with the
// propeller at the left. It is the only view that shows all four cylinders of
// an opposed engine at once: 1 and 3 on the upper bank, 2 and 4 on the lower,
// staggered along the crank by the width of a con-rod the way they really are.
//
// `out` says where the piston sits in its stroke. A boxer's opposed pair reaches
// top dead centre together, and the front pair runs 180 degrees from the rear -
// the same phasing the 3D model animates (see config/engine3d.js).
const CY = 320 // crankshaft centreline
const THROW = 20 // crank throw on screen: half of the 61 mm stroke

const CYLINDERS = [
  { n: 1, x: 322, up: true, out: true },
  { n: 2, x: 336, up: false, out: true },
  { n: 3, x: 516, up: true, out: false },
  { n: 4, x: 530, up: false, out: false },
]

const JOURNALS = [266, 372, 462, 570, 606]
const FIN_OFFSETS = [52, 60, 70, 80, 90, 100]

// Distances measured outward from the centreline, so one set of numbers draws
// both banks and the engine cannot drift out of symmetry.
const OUT = {
  caseEdge: 48,
  barrel: 108,
  head: 164,
  cover: 182,
  plug: 198,
  lead: 208,
  exhaustRun: 220,
  pistonOut: [88, 102],
  pistonIn: [52, 66],
}

// Half-widths either side of a cylinder's centre.
const HALF = { barrel: 32, fin: 42, head: 40, cover: 28, piston: 26 }

// Mirrors one bank onto the other: `at` turns a distance out from the
// centreline into a y on screen, `band` turns two of them into a rect.
function bank(up) {
  const dir = up ? -1 : 1
  const at = (offset) => CY + dir * offset
  const band = (a, b) => {
    const y0 = at(a)
    const y1 = at(b)
    return { y: Math.min(y0, y1), height: Math.abs(y1 - y0) }
  }
  return { dir, at, band }
}

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

// The blueprint cutaway, in plan view. Schematic, not to scale - the 3D view is
// the one built to the engine's published dimensions.
function Schematic2D({ health, selected, onSelect }) {
  const common = { health, selected, onSelect }

  return (
    <svg className="sim__svg" viewBox="0 0 1040 660" role="img" aria-label="Rotax 912 plan view with per-part health">
      <defs>
        <pattern id="sim-grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M26 0H0V26" />
        </pattern>
      </defs>
      <rect className="sim__grid" x="0" y="0" width="1040" height="660" fill="url(#sim-grid)" />

      {/* ---------- propeller, seen edge on from above ---------- */}
      <Part id="propeller" {...common}>
        <path className="part__shape" d="M106 302C100 256 106 198 112 152Q118 140 124 152C130 198 136 256 130 302Z" />
        <path className="part__shape" d="M106 338C100 384 106 442 112 488Q118 500 124 488C130 442 136 384 130 338Z" />
        <circle className="part__shape" cx="118" cy="320" r="19" />
        <circle className="part__detail-dot" cx="118" cy="320" r="8" />
        <path className="part__pipe part__pipe--thin" d="M137 320H146" />
        <Label x="118" y="566" id="propeller" health={health} leader="M118 550V496" />
      </Part>

      {/* ---------- 2.43:1 reduction drive ---------- */}
      <Part id="gearbox" {...common}>
        <rect className="part__shape" x="146" y="272" width="70" height="96" rx="10" />
        <circle className="part__detail-dot" cx="178" cy="298" r="22" />
        <circle className="part__detail-dot" cx="200" cy="342" r="12" />
        <path className="part__pipe part__pipe--thin" d="M216 320H248" />
        <Label x="150" y="432" id="gearbox" health={health} leader="M162 416L182 372" />
      </Part>

      {/* ---------- crankcase, crank, webs and rods ---------- */}
      <Part id="crankcase" {...common}>
        <rect className="part__shape" x="248" y="272" width="372" height="96" rx="6" />
        <path className="part__detail" d={`M248 ${CY}H620`} />
        <rect className="part__shape" x="228" y="296" width="20" height="48" rx="4" />
        {JOURNALS.map((x) => (
          <circle key={x} className="part__shape" cx={x} cy={CY} r="11" />
        ))}
        {[329, 523].map((x) => (
          <circle key={x} className="part__shape" cx={x} cy={CY} r="24" />
        ))}
        {CYLINDERS.map((c) => {
          const { dir, at } = bank(c.up)
          // The pin sits on the cylinder's own side when that piston is on its
          // way out, and opposite it when the piston is on its way in.
          const pinY = CY + (c.out ? dir : -dir) * THROW
          return (
            <g key={c.n}>
              <path className="part__rod" d={`M${c.x} ${pinY}L${c.x} ${at(c.out ? 95 : 59)}`} />
              <circle className="part__detail-dot" cx={c.x} cy={pinY} r="7" />
            </g>
          )
        })}
        <Label x="196" y="244" id="crankcase" health={health} leader="M212 252L252 286" />
      </Part>

      {/* ---------- four opposed cylinders: barrels, fins, heads, pistons ---------- */}
      <Part id="cylinders" {...common}>
        {CYLINDERS.map((c) => {
          const { at, band } = bank(c.up)
          const barrel = band(OUT.caseEdge, OUT.barrel)
          const head = band(OUT.barrel, OUT.head)
          const cover = band(OUT.head, OUT.cover)
          const piston = band(...(c.out ? OUT.pistonOut : OUT.pistonIn))

          return (
            <g key={c.n}>
              <rect
                className="part__shape"
                x={c.x - HALF.barrel}
                y={barrel.y}
                width={HALF.barrel * 2}
                height={barrel.height}
              />
              {/* Ram-air fins on the barrel. The 912 air-cools these and
                  liquid-cools only the head above them. */}
              {FIN_OFFSETS.map((o) => (
                <path key={o} className="part__fin" d={`M${c.x - HALF.fin} ${at(o)}H${c.x + HALF.fin}`} />
              ))}
              <rect
                className="part__shape"
                x={c.x - HALF.head}
                y={head.y}
                width={HALF.head * 2}
                height={head.height}
                rx="5"
              />
              <rect
                className="part__shape"
                x={c.x - HALF.cover}
                y={cover.y}
                width={HALF.cover * 2}
                height={cover.height}
                rx="3"
              />
              <rect
                className="part__shape"
                x={c.x - HALF.piston}
                y={piston.y}
                width={HALF.piston * 2}
                height={piston.height}
                rx="2"
              />
              <text className="part__num" x={c.x} y={at(132)} textAnchor="middle">
                {c.n}
              </text>
            </g>
          )
        })}
        <Label x="604" y="166" id="cylinders" health={health} leader="M592 180L558 192" />
      </Part>

      {/* ---------- dual ignition: two plugs in every head ---------- */}
      <Part id="combustion" {...common}>
        {CYLINDERS.map((c) => {
          const { at, band } = bank(c.up)
          const plug = band(OUT.cover, OUT.plug)
          return (
            <g key={c.n}>
              {[-20, 8].map((dx) => (
                <g key={dx}>
                  <rect className="part__shape" x={c.x + dx} y={plug.y} width="12" height={plug.height} rx="3" />
                  <path
                    className="part__detail"
                    d={`M${c.x + dx + 6} ${at(OUT.plug)}L${c.x + dx + 6} ${at(OUT.lead)}`}
                  />
                </g>
              ))}
            </g>
          )
        })}
        <Label x="246" y="136" id="combustion" health={health} anchor="end" leader="M256 136H296" />
      </Part>

      {/* ---------- airbox, runners and injectors (the iS is fuel injected) ---------- */}
      <Part id="injectors" {...common}>
        <rect className="part__shape" x="392" y="292" width="54" height="56" rx="8" />
        {CYLINDERS.map((c) => {
          const { at, band } = bank(c.up)
          const from = c.x < 419 ? 392 : 446
          const body = band(OUT.barrel - 16, OUT.barrel + 4)
          return (
            <g key={c.n}>
              <path
                className="part__pipe part__pipe--thin"
                d={`M${from} ${CY + (c.up ? -14 : 14)}Q${(from + c.x) / 2} ${at(40)} ${c.x} ${at(OUT.barrel - 4)}`}
              />
              <rect className="part__shape" x={c.x - 7} y={body.y} width="14" height={body.height} rx="3" />
            </g>
          )
        })}
        <path className="part__pipe part__pipe--flow" d="M255 70H452Q466 70 466 84V276Q466 292 452 296H446" />
        <Label x="412" y="240" id="injectors" health={health} leader="M412 254V292" />
      </Part>

      {/* ---------- fuel ---------- */}
      <Part id="fuel_tank" {...common}>
        <rect className="part__shape" x="30" y="34" width="166" height="74" rx="14" />
        <path className="part__detail" d="M54 98h118M100 30v-8h26v8" />
        <Label x="113" y="62" id="fuel_tank" health={health} />
      </Part>

      <Part id="fuel_pump" {...common}>
        <path className="part__pipe part__pipe--flow" d="M196 71H217" />
        <circle className="part__shape" cx="236" cy="71" r="19" />
        <path className="part__detail" d="M236 58v26M223 71h26" />
        <Label x="268" y="26" id="fuel_pump" health={health} anchor="start" leader="M270 40L252 56" />
      </Part>

      {/* ---------- exhaust: four headers into a collector and muffler ---------- */}
      <Part id="exhaust" {...common}>
        {CYLINDERS.map((c) => {
          const { at } = bank(c.up)
          return (
            <path
              key={c.n}
              className="part__pipe part__pipe--fat"
              d={`M${c.x} ${at(OUT.plug)}V${at(OUT.exhaustRun)}`}
            />
          )
        })}
        <path className="part__pipe part__pipe--fat" d="M322 100H688Q718 100 720 152V296" />
        <path className="part__pipe part__pipe--fat" d="M336 540H688Q718 540 720 488V344" />
        <rect className="part__shape" x="712" y="292" width="160" height="56" rx="14" />
        <path className="part__detail" d="M744 300v40M776 300v40M808 300v40M840 300v40" />
        <path className="part__pipe part__pipe--thin" d="M872 320H946" />
        <Label x="810" y="252" id="exhaust" health={health} leader="M810 266V292" />
      </Part>

      {/* ---------- cooling: radiator for the heads, ram air for the barrels ---------- */}
      <Part id="cooling" {...common}>
        <rect className="part__shape" x="300" y="566" width="172" height="80" rx="12" />
        <path className="part__detail" d="M324 574v64M348 574v64M372 574v64M396 574v64M420 574v64M444 574v64" />
        <path className="part__pipe part__pipe--thin" d="M330 566Q312 520 300 480" />
        <path className="part__pipe part__pipe--thin" d="M296 452Q250 430 232 370V270Q250 208 292 188" />
        <circle className="part__shape" cx="262" cy="232" r="14" />
        <Label x="386" y="600" id="cooling" health={health} />
      </Part>

      {/* ---------- engine mounts at the four corners of the case ---------- */}
      <Part id="mounts" {...common}>
        {[266, 590].map((x) => (
          <g key={x}>
            <rect className="part__shape" x={x - 13} y="258" width="26" height="14" rx="3" />
            <rect className="part__shape" x={x - 13} y="368" width="26" height="14" rx="3" />
            <circle className="part__detail-dot" cx={x} cy="265" r="4" />
            <circle className="part__detail-dot" cx={x} cy="375" r="4" />
          </g>
        ))}
        <Label x="206" y="500" id="mounts" health={health} leader="M206 484L264 382" />
      </Part>

      {/* ---------- oil: dry sump, so a separate tank rather than a wet pan ---------- */}
      <Part id="oil_sump" {...common}>
        <rect className="part__shape" x="740" y="140" width="160" height="76" rx="16" />
        <path className="part__detail" d="M760 206h120M806 136v-8h22v8" />
        <Label x="820" y="172" id="oil_sump" health={health} />
      </Part>

      <Part id="oil_pump" {...common}>
        <path className="part__pipe part__pipe--flow" d="M744 214Q706 300 684 366" />
        <circle className="part__shape" cx="660" cy="410" r="20" />
        <path className="part__detail" d="M660 395v30M645 410h30" />
        <path className="part__pipe part__pipe--flow" d="M680 416Q716 430 740 444" />
        <Label x="632" y="478" id="oil_pump" health={health} leader="M636 462L654 432" />
      </Part>

      <Part id="oil_cooler" {...common}>
        <rect className="part__shape" x="740" y="425" width="160" height="80" rx="12" />
        <path className="part__detail" d="M764 433v64M788 433v64M812 433v64M836 433v64M860 433v64M884 433v64" />
        <Label x="820" y="458" id="oil_cooler" health={health} />
      </Part>

      {/* ---------- electrical ---------- */}
      <Part id="alternator" {...common}>
        <path className="part__pipe part__pipe--thin" d="M620 306h10M620 334h10" />
        <circle className="part__shape" cx="660" cy="320" r="32" />
        <circle className="part__detail-dot" cx="660" cy="320" r="13" />
        <path className="part__detail" d="M686 300Q714 196 764 132H898Q928 132 940 120" />
        <Label x="628" y="228" id="alternator" health={health} leader="M634 242L652 290" />
      </Part>

      <Part id="battery" {...common}>
        <rect className="part__shape" x="906" y="40" width="124" height="78" rx="10" />
        <path className="part__detail" d="M926 40v-8h14v8M996 40v-8h14v8" />
        <Label x="968" y="72" id="battery" health={health} />
      </Part>
    </svg>
  )
}

export function EngineSimulation({ telemetry, stale, alerts }) {
  const { latest } = telemetry
  const [selected, setSelected] = useState('cylinders')
  const [view, setView] = useState('3d')

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
          <div className="segmented sim__view" role="group" aria-label="Engine view">
            <button type="button" aria-pressed={view === '2d'} onClick={() => setView('2d')}>
              2D schematic
            </button>
            <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>
              3D engine
            </button>
          </div>
          <ul className="sim__legend">
            <li className="sim__legend-item sim__legend-item--normal">Healthy</li>
            <li className="sim__legend-item sim__legend-item--warning">Degraded</li>
            <li className="sim__legend-item sim__legend-item--critical">At risk</li>
          </ul>
        </header>

        {view === '2d' ? (
          <Schematic2D health={health} selected={selected} onSelect={setSelected} />
        ) : (
          <Suspense fallback={<div className="sim__loading">Building the engine…</div>}>
            <Engine3D
              health={health}
              selected={selected}
              onSelect={setSelected}
              telemetry={latest}
              stale={stale}
            />
          </Suspense>
        )}

        <details className="sim__ref">
          <summary>
            Model reference — Rotax {SPEC.variant}
            <span>
              {SPEC.boreMm} × {SPEC.strokeMm} mm · {SPEC.displacementCc} cm³ · {SPEC.gearboxRatio}:1
            </span>
          </summary>
          <dl className="sim__ref-specs">
            <div>
              <dt>Layout</dt>
              <dd>{SPEC.layout}</dd>
            </div>
            <div>
              <dt>Cooling</dt>
              <dd>{SPEC.cooling}</dd>
            </div>
            <div>
              <dt>Lubrication</dt>
              <dd>{SPEC.lubrication}</dd>
            </div>
            <div>
              <dt>Ignition</dt>
              <dd>{SPEC.ignition}</dd>
            </div>
            <div>
              <dt>Rated</dt>
              <dd>
                {SPEC.ratedKw} kW at {SPEC.ratedRpm} rpm
              </dd>
            </div>
            <div>
              <dt>Envelope</dt>
              <dd>
                {SPEC.lengthMm} × {SPEC.widthMm} × {SPEC.heightMm} mm, {SPEC.dryWeightKg} kg
              </dd>
            </div>
          </dl>
          <ul className="sim__ref-links">
            {ENGINE_3D_SOURCES.map((source) => (
              <li key={source.href}>
                <a href={source.href} target="_blank" rel="noreferrer">
                  {source.label}
                </a>
                <span>{source.gives}</span>
              </li>
            ))}
          </ul>
          <p className="sim__ref-note">
            Both views follow these figures. The 3D model is built to them; the 2D plan view keeps the layout and
            proportions but is schematic, not to scale. Connecting rod length and casting wall thicknesses are not
            published by BRP-Rotax and are estimated.
          </p>
        </details>
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
