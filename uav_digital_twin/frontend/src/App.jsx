import { useCallback, useState } from 'react'
import { AlertToast } from './components/AlertToast.jsx'
import { ConnectionBadge } from './components/ConnectionBadge.jsx'
import { ALERTS_FROM_BACKEND, STALE_AFTER_MS } from './config/app.js'
import { useAlerts } from './hooks/useAlerts.js'
import { useNow } from './hooks/useNow.js'
import { useTelemetry } from './hooks/useTelemetry.js'
import { EngineSimulation } from './tabs/EngineSimulation.jsx'
import { EngineTrends } from './tabs/EngineTrends.jsx'
import { MaintenanceAdvisory } from './tabs/MaintenanceAdvisory.jsx'
import { LiveTelemetry } from './tabs/LiveTelemetry.jsx'

const TABS = [
  { id: 'live', label: 'Live telemetry' },
  { id: 'trends', label: 'Engine trends' },
  { id: 'engine', label: 'Engine simulation' },
  { id: 'maintenance', label: 'Maintenance advisory' },
]

const SOURCE_KEY = 'uav-dt:source'

// ?source=simulator|backend in the URL wins, then the last choice, then backend
function initialSource() {
  const fromUrl = new URLSearchParams(window.location.search).get('source')
  if (fromUrl === 'simulator' || fromUrl === 'backend') return fromUrl
  try {
    return localStorage.getItem(SOURCE_KEY) === 'simulator' ? 'simulator' : 'backend'
  } catch {
    return 'backend'
  }
}

export default function App() {
  const [tab, setTab] = useState('live')
  const [source, setSource] = useState(initialSource)
  const alerts = useAlerts()
  const telemetry = useTelemetry({ source, onAnomaly: ALERTS_FROM_BACKEND ? alerts.push : undefined })
  const now = useNow(500)

  const { latest } = telemetry
  const stale = !latest || now - latest.receivedAt > STALE_AFTER_MS

  const changeSource = (next) => {
    setSource(next)
    try {
      localStorage.setItem(SOURCE_KEY, next)
    } catch {
      // storage blocked - the choice just won't persist
    }
  }

  const { dismissToast } = alerts
  const openAlerts = useCallback(() => {
    setTab('live')
    dismissToast()
    requestAnimationFrame(() =>
      document.getElementById('alert-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    )
  }, [dismissToast])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg className="brand__mark" viewBox="0 0 36 36" aria-hidden="true">
            <rect width="36" height="36" rx="9" fill="var(--track)" />
            <path d="M8 24a10 10 0 0 1 20 0" fill="none" stroke="var(--good)" strokeWidth="3" strokeLinecap="round" />
            <path d="M18 24l5.5-7.5" stroke="var(--needle)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <div>
            <h1 className="brand__title">UAV Engine Digital Twin</h1>
            <p className="brand__sub">{latest?.engineId ?? 'ENGINE_001'} · MALE UAV aero piston engine</p>
          </div>
        </div>

        <div className="topbar__right">
          <ConnectionBadge
            source={source}
            link={telemetry.link}
            transport={telemetry.transport}
            stale={stale}
            lastReceivedAt={latest?.receivedAt}
            now={now}
          />
          <div className="segmented" role="group" aria-label="Data source">
            <button type="button" aria-pressed={source === 'backend'} onClick={() => changeSource('backend')}>
              Backend
            </button>
            <button type="button" aria-pressed={source === 'simulator'} onClick={() => changeSource('simulator')}>
              Simulated
            </button>
          </div>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Dashboard views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className="tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.soon && <span className="tab__soon">Soon</span>}
          </button>
        ))}
      </nav>

      <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'live' && <LiveTelemetry telemetry={telemetry} stale={stale} alerts={alerts} />}
        {tab === 'trends' && <EngineTrends telemetry={telemetry} stale={stale} now={now} />}
        {tab === 'engine' && <EngineSimulation telemetry={telemetry} stale={stale} alerts={alerts} />}
        {tab === 'maintenance' && <MaintenanceAdvisory alerts={alerts} />}
      </main>

      <AlertToast
        key={alerts.toast?.id ?? 'none'}
        alert={alerts.toast}
        onDismiss={dismissToast}
        onOpen={openAlerts}
      />
    </div>
  )
}
