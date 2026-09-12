import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config/app.js'
import { ENGINE_PARTS } from '../config/engineParts.js'
import { SEVERITY_META, faultTitle } from '../config/faults.js'
import { ALIASES, INTERVAL_ORDER, adviceFor } from '../config/maintenance.js'
import { formatClock } from '../lib/format.js'
import './MaintenanceAdvisory.css'

const STORE_KEY = 'uav-dt:maintenance-actioned'
const SEVERITY_RANK = { MEDIUM: 1, HIGH: 2, CRITICAL: 3 }
const REFRESH_MS = 30_000
// An alert seen within this long still counts as happening now
const ACTIVE_WINDOW_MS = 120_000

// Postgres can hand timestamps back without a zone; treat those as UTC
function parseTime(timestamp) {
  if (!timestamp) return 0
  const text = String(timestamp)
  const value = Date.parse(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`)
  return Number.isFinite(value) ? value : 0
}

function loadActioned() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}
  } catch {
    return {}
  }
}

// Recorded fault events from the database, so advice survives a page reload
function useFaultSummary() {
  const [state, setState] = useState({ faults: [], total: 0, status: 'loading' })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/fault-summary`)
        const body = await res.json()
        if (cancelled) return
        if (!res.ok || body.error || !Array.isArray(body.faults)) throw new Error('bad response')
        setState({ faults: body.faults, total: body.total_faults ?? 0, status: 'ok' })
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, status: 'offline' }))
      }
    }

    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return state
}

const worse = (a, b) => ((SEVERITY_RANK[b] ?? 0) > (SEVERITY_RANK[a] ?? 0) ? b : a)

// Merges this session's alerts with the recorded fault events into one advisory per fault
function buildAdvisories(items, recorded, actioned) {
  const byType = new Map()

  // v1 and v2 have different names for the same fault (LOW_OIL_PRESSURE /
  // LUBRICATION_ISSUE), so both land in one advisory
  const entry = (reported) => {
    const type = ALIASES[reported] ?? reported
    if (!byType.has(type)) {
      byType.set(type, {
        type,
        names: new Set(),
        sessionCount: 0,
        recordedCount: 0,
        lastSeen: 0,
        severity: null,
        active: false,
        onlyTest: true,
      })
    }
    const it = byType.get(type)
    it.names.add(reported)
    return it
  }

  for (const alert of items) {
    const it = entry(alert.fault_type)
    const last = parseTime(alert.lastTimestamp ?? alert.timestamp)
    it.sessionCount += alert.count ?? 1
    it.lastSeen = Math.max(it.lastSeen, last)
    it.severity = worse(it.severity, alert.severity)
    if (!alert.acknowledged && Date.now() - last < ACTIVE_WINDOW_MS) it.active = true
    if (alert.source !== 'manual') it.onlyTest = false
  }

  for (const fault of recorded) {
    const it = entry(fault.fault_type)
    it.recordedCount += fault.count ?? 0
    it.lastSeen = Math.max(it.lastSeen, parseTime(fault.last_seen))
    it.onlyTest = false
    for (const severity of fault.severities ?? []) it.severity = worse(it.severity, severity)
  }

  return [...byType.values()]
    .map((it) => {
      const actionedAt = parseTime(actioned[it.type])
      return {
        ...it,
        advice: adviceFor(it.type),
        // a part counts as affected if it lists any of the names this fault was logged under
        parts: ENGINE_PARTS.filter((part) => part.faults.some((name) => it.names.has(name))).map(
          (part) => part.short ?? part.label,
        ),
        alsoKnownAs: [...it.names].filter((name) => name !== it.type),
        occurrences: Math.max(it.recordedCount, it.sessionCount),
        done: actionedAt > 0 && actionedAt >= it.lastSeen,
      }
    })
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      if (a.active !== b.active) return a.active ? -1 : 1
      const severity = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
      if (severity) return severity
      return b.occurrences - a.occurrences
    })
}

// Every preventive task from the advisories on screen, grouped by how often it is due
function buildSchedule(advisories) {
  const byInterval = new Map()

  for (const advisory of advisories) {
    for (const task of advisory.advice.prevent) {
      if (!byInterval.has(task.every)) byInterval.set(task.every, new Map())
      const tasks = byInterval.get(task.every)
      if (!tasks.has(task.do)) tasks.set(task.do, [])
      tasks.get(task.do).push(faultTitle(advisory.type))
    }
  }

  return [...byInterval.entries()]
    .sort((a, b) => INTERVAL_ORDER.indexOf(a[0]) - INTERVAL_ORDER.indexOf(b[0]))
    .map(([every, tasks]) => ({
      every,
      tasks: [...tasks.entries()].map(([task, faults]) => ({ task, faults })),
    }))
}

function Step({ number, title, when, items }) {
  return (
    <section className="step">
      <h4 className="step__title">
        <span className="step__number">{number}</span>
        {title}
        <span className="step__when">{when}</span>
      </h4>
      <ul className="step__list">
        {items.map((item) =>
          typeof item === 'string' ? (
            <li key={item}>{item}</li>
          ) : (
            <li key={item.do}>
              <span className="step__every">{item.every}</span>
              {item.do}
            </li>
          ),
        )}
      </ul>
    </section>
  )
}

function Advisory({ advisory, open, onOpen, onDone }) {
  const severity = SEVERITY_META[advisory.severity] ?? SEVERITY_META.HIGH
  const { advice } = advisory

  return (
    <article
      className={`advice advice--${severity.tone}${advisory.done ? ' is-done' : ''}${open ? ' is-open' : ''}`}
    >
      <header className="advice__head">
        <h3 className="advice__name">{faultTitle(advisory.type)}</h3>
        <span className="advice__sev">{severity.label}</span>
        {advisory.active && <span className="advice__tag advice__tag--now">Happening now</span>}
        {advisory.done && <span className="advice__tag">Actioned</span>}
        {advisory.onlyTest && <span className="advice__tag">Test trigger</span>}
      </header>

      <p className="advice__summary">{advice.summary}</p>

      {!open && (
        <p className="advice__first">
          <span className="advice__first-label">Do first</span>
          {advice.now[0]}
        </p>
      )}

      <p className="advice__meta">
        Seen {advisory.occurrences}×
        {advisory.lastSeen > 0 && <> · last {formatClock(advisory.lastSeen)}</>}
        {advisory.parts.length > 0 && <> · {advisory.parts.join(', ')}</>}
      </p>

      {open && (
        <div className="advice__steps">
          <Step number="1" title="In the air" when="while it is happening" items={advice.now} />
          <Step number="2" title="On the ground" when="check and repair" items={advice.inspect} />
          <Step number="3" title="Later" when="so it does not come back" items={advice.prevent} />
        </div>
      )}

      <div className="advice__actions">
        <button type="button" className="btn btn--sm" onClick={() => onOpen(advisory.type)}>
          {open ? 'Hide steps' : 'Show steps'}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => onDone(advisory)}>
          {advisory.done ? 'Reopen' : 'Mark actioned'}
        </button>
        {open && advisory.alsoKnownAs.length > 0 && (
          <span className="advice__alias">
            also logged as {advisory.alsoKnownAs.map((name) => faultTitle(name)).join(', ')}
          </span>
        )}
      </div>
    </article>
  )
}

export function MaintenanceAdvisory({ alerts }) {
  const summary = useFaultSummary()
  const [actioned, setActioned] = useState(loadActioned)
  const [openTypes, setOpenTypes] = useState(null)
  const [showSchedule, setShowSchedule] = useState(false)

  const advisories = useMemo(
    () => buildAdvisories(alerts.items, summary.faults, actioned),
    [alerts.items, summary.faults, actioned],
  )

  const schedule = useMemo(() => buildSchedule(advisories), [advisories])
  const taskCount = schedule.reduce((total, group) => total + group.tasks.length, 0)

  // Until something is clicked, the most urgent advisory is the one left open
  const isOpen = (type, index) => (openTypes ? openTypes.has(type) : index === 0)

  const toggleOpen = useCallback(
    (type) => {
      setOpenTypes((prev) => {
        const next = new Set(prev ?? (advisories[0] ? [advisories[0].type] : []))
        if (next.has(type)) next.delete(type)
        else next.add(type)
        return next
      })
    },
    [advisories],
  )

  const toggleDone = useCallback((advisory) => {
    setActioned((prev) => {
      const next = { ...prev }
      if (advisory.done) delete next[advisory.type]
      else next[advisory.type] = new Date().toISOString()
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next))
      } catch {
        // storage blocked - the choice just won't persist
      }
      return next
    })
  }, [])

  const open = advisories.filter((a) => !a.done)
  const urgent = open.filter((a) => a.active || a.severity === 'CRITICAL')

  return (
    <div className="maint">
      <section className="card maint__head">
        <p className="maint__count">
          <strong>{open.length}</strong> {open.length === 1 ? 'advisory' : 'advisories'} open
          {urgent.length > 0 && (
            <>
              , <strong className="maint__count--alarm">{urgent.length}</strong> needing attention now
            </>
          )}
        </p>
        <p className="maint__source">
          {summary.status === 'ok'
            ? `From ${summary.total} recorded faults and this session's alerts`
            : summary.status === 'loading'
              ? 'Loading recorded faults…'
              : 'Backend offline — this session only'}
        </p>
      </section>

      {advisories.length === 0 ? (
        <section className="card maint__empty">
          <strong>Nothing to advise on yet</strong>
          <span>Advisories appear here as soon as the detector raises a fault.</span>
        </section>
      ) : (
        <div className="maint__list">
          {advisories.map((advisory, index) => (
            <Advisory
              key={advisory.type}
              advisory={advisory}
              open={isOpen(advisory.type, index)}
              onOpen={toggleOpen}
              onDone={toggleDone}
            />
          ))}
        </div>
      )}

      {schedule.length > 0 && (
        <section className="card maint__schedule">
          <button
            type="button"
            className="maint__schedule-toggle"
            onClick={() => setShowSchedule((value) => !value)}
            aria-expanded={showSchedule}
          >
            <span>Preventive schedule</span>
            <span className="maint__schedule-count">
              {taskCount} tasks · {schedule.length} intervals
            </span>
            <span className="maint__chevron">{showSchedule ? '−' : '+'}</span>
          </button>

          {showSchedule &&
            schedule.map((group) => (
              <div key={group.every} className="maint__group">
                <h3 className="maint__every">{group.every}</h3>
                <ul className="maint__tasks">
                  {group.tasks.map(({ task, faults }) => (
                    <li key={task}>
                      {task}
                      <span className="maint__from">{faults.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </section>
      )}

      <p className="maint__note">
        Generic guidance for a MALE UAV piston engine — where the engine manual differs, follow the manual.
      </p>
    </div>
  )
}
