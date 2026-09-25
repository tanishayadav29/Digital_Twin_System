import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config/app.js'
import { MissionHealthReport } from '../components/MissionHealthReport.jsx'
import { ENGINE_PARTS } from '../config/engineParts.js'
import { SEVERITY_META, faultTitle } from '../config/faults.js'
import { ALIASES, INTERVAL_ORDER, adviceFor } from '../config/maintenance.js'
import { generateAdvisory } from '../lib/advisory.js'
import { healthFor } from '../lib/health.js'
import { formatClock } from '../lib/format.js'
import { withZone } from '../lib/readings.js'
import './MaintenanceAdvisory.css'

const STORE_KEY = 'uav-dt:maintenance-actioned'
const SEVERITY_RANK = {
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
}

const REFRESH_MS = 30_000

// An alert seen within this long still counts as happening now
const ACTIVE_WINDOW_MS = 120_000

// ============================================================
// TIME PARSER
// ============================================================

// Postgres can hand timestamps back without a zone; treat those as UTC
function parseTime(timestamp) {
  if (!timestamp) return 0

  const text = String(timestamp)

  const value = Date.parse(
    /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(text)
      ? text
      : `${text}Z`,
  )

  return Number.isFinite(value) ? value : 0
}

// ============================================================
// ACTIONED STATE
// ============================================================

function loadActioned() {
  try {
    return JSON.parse(
      localStorage.getItem(STORE_KEY),
    ) ?? {}
  } catch {
    return {}
  }
}

// ============================================================
// RECORDED FAULT SUMMARY
// ============================================================

// Recorded fault events from the database,
// so advice survives a page reload.
function useFaultSummary() {
  const [state, setState] = useState({
    faults: [],
    total: 0,
    status: 'loading',
  })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/fault-summary`,
        )

        const body = await res.json()

        if (cancelled) {
          return
        }

        if (
          !res.ok ||
          body.error ||
          !Array.isArray(body.faults)
        ) {
          throw new Error('bad response')
        }

        setState({
          faults: body.faults,
          total: body.total_faults ?? 0,
          status: 'ok',
        })
      } catch {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            status: 'offline',
          }))
        }
      }
    }

    load()

    const timer = setInterval(
      load,
      REFRESH_MS,
    )

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return state
}

// ============================================================
// SEVERITY HELPER
// ============================================================

const worse = (a, b) =>
  (
    (SEVERITY_RANK[b] ?? 0) >
    (SEVERITY_RANK[a] ?? 0)
      ? b
      : a
  )

// ============================================================
// BUILD MAINTENANCE ADVISORIES
// ============================================================

// Merges this session's alerts with the recorded
// fault events into one advisory per fault.
function buildAdvisories(
  items,
  recorded,
  actioned,
  health,
  liveRul,
) {
  const byType = new Map()

  // v1 and v2 have different names for the same fault
  // (LOW_OIL_PRESSURE / LUBRICATION_ISSUE),
  // so both land in one advisory.
  const entry = (reported) => {
    const type =
      ALIASES[reported] ?? reported

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
        rulSeconds: null,
        // Sensors the detector flagged in the most recent alert
        sensors: [],
      })
    }

    const it = byType.get(type)

    it.names.add(reported)

    return it
  }

  // ----------------------------------------------------------
  // SESSION ALERTS
  // ----------------------------------------------------------

  for (const alert of items) {
    const it = entry(alert.fault_type)

    const last = parseTime(
      alert.lastTimestamp ??
      alert.timestamp,
    )

    it.sessionCount += alert.count ?? 1

    if (last >= it.lastSeen) {
      it.sensors = alert.sensors ?? []
    }

    it.lastSeen = Math.max(
      it.lastSeen,
      last,
    )

    it.severity = worse(
      it.severity,
      alert.severity,
    )

    if (
      !alert.acknowledged &&
      Date.now() - last < ACTIVE_WINDOW_MS
    ) {
      it.active = true
    }

    if (alert.source !== 'manual') {
      it.onlyTest = false
    }
  }

  // ----------------------------------------------------------
  // RECORDED DATABASE FAULTS
  // ----------------------------------------------------------

  for (const fault of recorded) {
    const it = entry(fault.fault_type)

    it.recordedCount +=
      fault.count ?? 0

    it.lastSeen = Math.max(
      it.lastSeen,
      parseTime(fault.last_seen),
    )

    it.onlyTest = false

    // Keep the RUL calculated when this fault was detected.
    if (
      typeof fault.latest_rul_seconds ===
        'number' &&
      Number.isFinite(
        fault.latest_rul_seconds,
      )
    ) {
      it.rulSeconds =
        fault.latest_rul_seconds
    }

    for (
      const severity of
      fault.severities ?? []
    ) {
      it.severity = worse(
        it.severity,
        severity,
      )
    }
  }

  // ----------------------------------------------------------
  // CONVERT TO ADVISORY OBJECTS
  // ----------------------------------------------------------

  return [...byType.values()]
    .map((it) => {
      const actionedAt = parseTime(
        actioned[it.type],
      )

      // Find affected engine parts
      let affectedParts =
        ENGINE_PARTS.filter((part) =>
          part.faults.some((name) =>
            it.names.has(name),
          ),
        )

      // UNKNOWN_ANOMALY is not tied to any part:
      // use the parts behind the sensors the
      // detector flagged in its latest alert.
      if (
        affectedParts.length === 0 &&
        it.type === 'UNKNOWN_ANOMALY'
      ) {
        affectedParts = ENGINE_PARTS.filter(
          (part) =>
            part.sensors.some((key) =>
              it.sensors.includes(key),
            ),
        )
      }

      const parts = affectedParts.map(
        (part) =>
          part.short ?? part.label,
      )

      // Find the lowest health among affected parts
      const affectedHealth =
        affectedParts
          .map(
            (part) =>
              health?.[part.id]?.health,
          )
          .filter(
            (value) =>
              typeof value === 'number',
          )

      const lowestHealth =
        affectedHealth.length
          ? Math.min(...affectedHealth)
          : null

      // Total occurrences
      const occurrences = Math.max(
        it.recordedCount,
        it.sessionCount,
      )

      // Generate predictive advisory using:
      // fault severity + affected component health + RUL
      const predictive =
        generateAdvisory({
          faultType: it.type,
          severity: it.severity,
          health: lowestHealth,

          // RUL = seconds until the fault is fully
          // developed, so it only means something
          // while the fault is happening. Prefer the
          // live estimate when the live fault is this
          // one, else the latest recorded estimate.
          rulSeconds: it.active
            ? (liveRul &&
              (ALIASES[liveRul.fault_type] ??
                liveRul.fault_type) === it.type
                ? liveRul.seconds
                : it.rulSeconds)
            : null,

          occurrences,
          affectedParts: parts,
          active: it.active,
        })

      return {
        ...it,

        // Existing maintenance advice
        advice: adviceFor(it.type),

        // New predictive maintenance information
        predictive,

        // Affected engine parts
        parts,

        // Other names used for the same fault
        alsoKnownAs: [
          ...it.names,
        ].filter(
          (name) =>
            name !== it.type,
        ),

        // Number of occurrences
        occurrences,

        // Whether the advisory has been actioned
        done:
          actionedAt > 0 &&
          actionedAt >= it.lastSeen,
      }
    })
    .sort((a, b) => {
      if (a.done !== b.done) {
        return a.done ? 1 : -1
      }

      if (a.active !== b.active) {
        return a.active ? -1 : 1
      }

      const severity =
        (SEVERITY_RANK[b.severity] ?? 0) -
        (SEVERITY_RANK[a.severity] ?? 0)

      if (severity) {
        return severity
      }

      return (
        b.occurrences -
        a.occurrences
      )
    })
}

// ============================================================
// PREVENTIVE SCHEDULE
// ============================================================

// Every preventive task from the advisories
// on screen, grouped by how often it is due.
function buildSchedule(advisories) {
  const byInterval = new Map()

  for (const advisory of advisories) {
    for (
      const task of
      advisory.advice.prevent
    ) {
      if (
        !byInterval.has(task.every)
      ) {
        byInterval.set(
          task.every,
          new Map(),
        )
      }

      const tasks =
        byInterval.get(
          task.every,
        )

      if (!tasks.has(task.do)) {
        tasks.set(task.do, [])
      }

      tasks
        .get(task.do)
        .push(
          faultTitle(
            advisory.type,
          ),
        )
    }
  }

  return [...byInterval.entries()]
    .sort(
      (a, b) =>
        INTERVAL_ORDER.indexOf(a[0]) -
        INTERVAL_ORDER.indexOf(b[0]),
    )
    .map(
      ([every, tasks]) => ({
        every,
        tasks: [
          ...tasks.entries(),
        ].map(
          ([task, faults]) => ({
            task,
            faults,
          }),
        ),
      }),
    )
}

// ============================================================
// MAINTENANCE STEP COMPONENT
// ============================================================

function Step({
  number,
  title,
  when,
  items,
}) {
  return (
    <section className="step">
      <h4 className="step__title">
        <span className="step__number">
          {number}
        </span>

        {title}

        <span className="step__when">
          {when}
        </span>
      </h4>

      <ul className="step__list">
        {items.map((item) =>
          typeof item === 'string' ? (
            <li key={item}>
              {item}
            </li>
          ) : (
            <li key={item.do}>
              <span className="step__every">
                {item.every}
              </span>

              {item.do}
            </li>
          ),
        )}
      </ul>
    </section>
  )
}

// ============================================================
// ADVISORY CARD
// ============================================================

function Advisory({
  advisory,
  open,
  onOpen,
  onDone,
}) {
  const severity =
    SEVERITY_META[
      advisory.severity
    ] ??
    SEVERITY_META.HIGH

  const { advice } = advisory

  return (
    <article
      className={`advice advice--${severity.tone}${
        advisory.done
          ? ' is-done'
          : ''
      }${
        open
          ? ' is-open'
          : ''
      }`}
    >
      <header className="advice__head">
        <h3 className="advice__name">
          {faultTitle(
            advisory.type,
          )}
        </h3>

        <span className="advice__sev">
          {severity.label}
        </span>

        {advisory.active && (
          <span className="advice__tag advice__tag--now">
            Happening now
          </span>
        )}

        {advisory.done && (
          <span className="advice__tag">
            Actioned
          </span>
        )}

        {advisory.onlyTest && (
          <span className="advice__tag">
            Test trigger
          </span>
        )}
      </header>

      <p className="advice__summary">
        {advice.summary}
      </p>

      {!open && (
        <p className="advice__first">
          <span className="advice__first-label">
            Do first
          </span>

          {advice.now[0]}
        </p>
      )}

      <p className="advice__meta">
        Seen {advisory.occurrences}
        {advisory.lastSeen > 0 && (
          <>
            {' '}· last{' '}
            {formatClock(
              advisory.lastSeen,
            )}
          </>
        )}

        {advisory.parts.length >
          0 && (
          <>
            {' '}·{' '}
            {advisory.parts.join(
              ', ',
            )}
          </>
        )}
      </p>

      {advisory.predictive && (
        <div className="advice__predictive">
          <div className="advice__predictive-title">
            Predictive assessment
          </div>

          <div className="advice__predictive-grid">
            <div>
              <span>
                Priority
              </span>

              <strong>
                {
                  advisory
                    .predictive
                    .severity
                }
              </strong>
            </div>

            <div>
              <span>
                Health
              </span>

              <strong>
                {advisory.predictive
                  .health != null
                  ? `${advisory.predictive.health}%`
                  : 'N/A'}
              </strong>
            </div>

            <div>
              <span>
                RUL
              </span>

              <strong>
                {advisory.predictive
                  .rulSeconds != null
                  ? `${advisory.predictive.rulSeconds.toFixed(1)} s`
                  : advisory.active
                    ? 'N/A'
                    : 'Not active'}
              </strong>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="advice__steps">
          <Step
            number="1"
            title="In the air"
            when="while it is happening"
            items={advice.now}
          />

          <Step
            number="2"
            title="On the ground"
            when="check and repair"
            items={advice.inspect}
          />

          <Step
            number="3"
            title="Later"
            when="so it does not come back"
            items={advice.prevent}
          />
        </div>
      )}

      <div className="advice__actions">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() =>
            onOpen(advisory.type)
          }
        >
          {open
            ? 'Hide steps'
            : 'Show steps'}
        </button>

        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() =>
            onDone(advisory)
          }
        >
          {advisory.done
            ? 'Reopen'
            : 'Mark actioned'}
        </button>

        {open &&
          advisory.alsoKnownAs
            .length > 0 && (
            <span className="advice__alias">
              also logged as{' '}
              {advisory.alsoKnownAs
                .map((name) =>
                  faultTitle(name),
                )
                .join(', ')}
            </span>
          )}
      </div>
    </article>
  )
}

// ============================================================
// MAIN MAINTENANCE ADVISORY COMPONENT
// ============================================================

export function MaintenanceAdvisory({
  telemetry,
  stale,
  alerts,
}) {
  // ----------------------------------------------------------
  // CURRENT LIVE READING
  // ----------------------------------------------------------

  const latest =
    telemetry?.latest

  // ----------------------------------------------------------
  // CURRENT ENGINE HEALTH
  // ----------------------------------------------------------

  const health = healthFor({
    latest,
    stale,
    alerts: alerts.items,
  })

  // ----------------------------------------------------------
  // CURRENT LIVE RUL
  // ----------------------------------------------------------

  // { seconds, fault_type, ... } while the latest
  // reading is an anomaly, otherwise null
  const liveRul =
    typeof latest?.fault?.rul
      ?.seconds === 'number'
      ? latest.fault.rul
      : null

  // ----------------------------------------------------------
  // DATABASE FAULT SUMMARY
  // ----------------------------------------------------------

  const summary =
    useFaultSummary()

  // ----------------------------------------------------------
  // LOCAL UI STATE
  // ----------------------------------------------------------

  const [
    actioned,
    setActioned,
  ] = useState(
    loadActioned,
  )

  const [
    openTypes,
    setOpenTypes,
  ] = useState(null)

  const [
    showSchedule,
    setShowSchedule,
  ] = useState(false)

  // ----------------------------------------------------------
  // MISSION HEALTH REPORT READINGS
  // ----------------------------------------------------------

  const [
    reportReadings,
    setReportReadings,
  ] = useState([])

  // ----------------------------------------------------------
  // LOAD TELEMETRY FOR HEALTH REPORT
  // ----------------------------------------------------------

  useEffect(() => {
    let cancelled = false

    async function loadReportReadings() {
      try {
        const response =
          await fetch(
            `${API_BASE}/sensor-history?limit=500`,
          )

        if (!response.ok) {
          throw new Error(
            `Failed to load report telemetry: ${response.status}`,
          )
        }

        const data =
          await response.json()

        if (cancelled) {
          return
        }

        const rows =
          Array.isArray(
            data.readings,
          )
            ? data.readings
            : []

        // Convert backend sensor rows into
        // MissionHealthReport's expected format.
        const normalized =
          rows
            .map((reading) => ({
              // Backend timestamps are UTC without a zone;
              // a bare Date.parse would read them as local time.
              time: Date.parse(
                withZone(reading.timestamp),
              ),

              engineId:
                reading.engine_id,

              values: {
                rpm: reading.rpm,
                cht: reading.cht,
                egt: reading.egt,
                oil_pressure:
                  reading.oil_pressure,
                oil_temperature:
                  reading.oil_temperature,
                fuel_flow:
                  reading.fuel_flow,
                vibration:
                  reading.vibration,
                battery_voltage:
                  reading.battery_voltage,
                alternator_current:
                  reading.alternator_current,
                injection_timing:
                  reading.injection_timing,
              },

              fault: {},
            }))

            // Remove invalid timestamps.
            .filter(
              (reading) =>
                Number.isFinite(
                  reading.time,
                ),
            )

            // IMPORTANT:
            // /sensor-history?limit=500 returns
            // newest -> oldest.
            //
            // MissionHealthReport expects:
            // oldest -> newest.
            //
            // Without this sort:
            // readings[0] = newest
            // readings[last] = oldest
            //
            // That makes the fault-analysis
            // start/end window reversed.
            .sort(
              (a, b) =>
                a.time - b.time,
            )

        setReportReadings(
          normalized,
        )
      } catch (error) {
        console.error(
          'Maintenance report telemetry failed:',
          error,
        )

        if (!cancelled) {
          setReportReadings([])
        }
      }
    }

    loadReportReadings()

    return () => {
      cancelled = true
    }
  }, [])

  // ----------------------------------------------------------
  // BUILD ADVISORIES
  // ----------------------------------------------------------

  const advisories = useMemo(
    () =>
      buildAdvisories(
        alerts.items,
        summary.faults,
        actioned,
        health,
        liveRul,
      ),
    [
      alerts.items,
      summary.faults,
      actioned,
      health,
      liveRul,
    ],
  )

  // ----------------------------------------------------------
  // PREVENTIVE SCHEDULE
  // ----------------------------------------------------------

  const schedule =
    useMemo(
      () =>
        buildSchedule(
          advisories,
        ),
      [advisories],
    )

  const taskCount =
    schedule.reduce(
      (total, group) =>
        total +
        group.tasks.length,
      0,
    )

  // Until something is clicked,
  // the most urgent advisory is left open.
  const isOpen = (
    type,
    index,
  ) =>
    openTypes
      ? openTypes.has(type)
      : index === 0

  // ----------------------------------------------------------
  // OPEN/CLOSE ADVISORY
  // ----------------------------------------------------------

  const toggleOpen =
    useCallback(
      (type) => {
        setOpenTypes(
          (prev) => {
            const next =
              new Set(
                prev ??
                  (advisories[0]
                    ? [
                        advisories[0]
                          .type,
                      ]
                    : []),
              )

            if (next.has(type)) {
              next.delete(type)
            } else {
              next.add(type)
            }

            return next
          },
        )
      },
      [advisories],
    )

  // ----------------------------------------------------------
  // MARK ACTIONED
  // ----------------------------------------------------------

  const toggleDone =
    useCallback(
      (advisory) => {
        setActioned(
          (prev) => {
            const next = {
              ...prev,
            }

            if (advisory.done) {
              delete next[
                advisory.type
              ]
            } else {
              next[
                advisory.type
              ] =
                new Date().toISOString()
            }

            try {
              localStorage.setItem(
                STORE_KEY,
                JSON.stringify(
                  next,
                ),
              )
            } catch {
              // storage blocked -
              // choice will not persist
            }

            return next
          },
        )
      },
      [],
    )

  // ----------------------------------------------------------
  // STATUS COUNTS
  // ----------------------------------------------------------

  const open =
    advisories.filter(
      (a) => !a.done,
    )

  const urgent =
    open.filter(
      (a) =>
        a.active ||
        a.severity ===
          'CRITICAL',
    )

  // ----------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------

  return (
    <div className="maint">
      {/* ======================================================
          MAINTENANCE HEADER
      ====================================================== */}

      <section className="card maint__head">
        <p className="maint__count">
          <strong>
            {open.length}
          </strong>{' '}
          {open.length === 1
            ? 'advisory'
            : 'advisories'}{' '}
          open

          {urgent.length > 0 && (
            <>
              ,{' '}
              <strong className="maint__count--alarm">
                {urgent.length}
              </strong>{' '}
              needing attention now
            </>
          )}
        </p>

        <p className="maint__source">
          {summary.status ===
          'ok'
            ? `From ${summary.total} recorded faults and this session's alerts`
            : summary.status ===
              'loading'
              ? 'Loading recorded faults…'
              : 'Backend offline — this session only'}
        </p>
      </section>

      {/* ======================================================
          ADVISORY CARDS
      ====================================================== */}

      {advisories.length ===
      0 ? (
        <section className="card maint__empty">
          <strong>
            Nothing to advise
            on yet
          </strong>

          <span>
            Advisories appear here
            as soon as the detector
            raises a fault.
          </span>
        </section>
      ) : (
        <div className="maint__list">
          {advisories.map(
            (
              advisory,
              index,
            ) => (
              <Advisory
                key={
                  advisory.type
                }
                advisory={
                  advisory
                }
                open={isOpen(
                  advisory.type,
                  index,
                )}
                onOpen={
                  toggleOpen
                }
                onDone={
                  toggleDone
                }
              />
            ),
          )}
        </div>
      )}

      {/* ======================================================
          PREVENTIVE SCHEDULE
      ====================================================== */}

      {schedule.length > 0 && (
        <section className="card maint__schedule">
          <button
            type="button"
            className="maint__schedule-toggle"
            onClick={() =>
              setShowSchedule(
                (value) =>
                  !value,
              )
            }
            aria-expanded={
              showSchedule
            }
          >
            <span>
              Preventive schedule
            </span>

            <span className="maint__schedule-count">
              {taskCount} tasks ·{' '}
              {schedule.length}{' '}
              intervals
            </span>

            <span className="maint__chevron">
              {showSchedule
                ? '−'
                : '+'}
            </span>
          </button>

          {showSchedule &&
            schedule.map(
              (group) => (
                <div
                  key={
                    group.every
                  }
                  className="maint__group"
                >
                  <h3 className="maint__every">
                    {group.every}
                  </h3>

                  <ul className="maint__tasks">
                    {group.tasks.map(
                      ({
                        task,
                        faults,
                      }) => (
                        <li
                          key={
                            task
                          }
                        >
                          {task}

                          <span className="maint__from">
                            {faults.join(
                              ', ',
                            )}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ),
            )}
        </section>
      )}

      {/* ======================================================
          FULL MISSION HEALTH REPORT
      ====================================================== */}

      <section className="maint__health-report">
        <MissionHealthReport
          readings={
            reportReadings
          }
          summary={null}
          description={`Latest ${reportReadings.length} readings from the database, loaded when this page was opened. For a specific flight, use the Replay tab.`}
        />
      </section>

      {/* ======================================================
          DISCLAIMER
      ====================================================== */}

      <p className="maint__note">
        Generic guidance for a
        MALE UAV piston engine —
        where the engine manual
        differs, follow the manual.
      </p>
    </div>
  )
}