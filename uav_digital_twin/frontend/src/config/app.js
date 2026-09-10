// Both paths go through the Vite dev-server proxy (see vite.config.js), so the
// browser never talks to port 8000 directly.
export const WS_PATH = '/ws/telemetry'
export const API_BASE = '/api'

export const POLL_INTERVAL_MS = 1000 // REST fallback rate while the WebSocket is down
export const WS_RETRY_MS = 5000 // how often to retry the WebSocket
export const STALE_AFTER_MS = 3500 // no new reading for this long = "no signal"

export const HISTORY_SIZE = 900 // readings kept in memory (15 min at 1 Hz), feeds the trends tab
export const BACKFILL_LIMIT = 500 // readings loaded from GET /sensor-history on start (backend max)
export const SPARKLINE_POINTS = 120 // live-tab mini charts show the last 2 min

export const TREND_RANGES = [
  { id: '2m', label: '2 min', ms: 2 * 60_000 },
  { id: '5m', label: '5 min', ms: 5 * 60_000 },
  { id: '15m', label: '15 min', ms: 15 * 60_000 },
]

// Flip to true once the Isolation Forest publishes messages like
//   {"type": "anomaly", "timestamp": "...", "fault_type": "OVERHEATING",
//    "severity": "HIGH", "confidence": 0.93, "description": "...", "sensors": ["cht"]}
// on /ws/telemetry. Until then alerts only come from the manual test trigger.
export const ALERTS_FROM_BACKEND = false
