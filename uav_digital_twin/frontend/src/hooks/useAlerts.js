import { useCallback, useRef, useState } from 'react'
import { FAULT_TYPES } from '../config/faults.js'

const MAX_ALERTS = 50
// A fault lasts many readings and the backend reports every one. The same fault
// again within this long updates the open alert (count, last seen) instead of
// adding a new alert and a new toast.
const REPEAT_WINDOW_MS = 15_000
let nextId = 1

function mergeRepeat(alert, repeat) {
  return {
    ...alert,
    count: alert.count + 1,
    lastTimestamp: repeat.timestamp,
    anomaly_score: repeat.anomaly_score ?? alert.anomaly_score,
    model_prediction: alert.model_prediction === 'ANOMALY' ? 'ANOMALY' : (repeat.model_prediction ?? alert.model_prediction),
    sensors: [...new Set([...alert.sensors, ...repeat.sensors])],
  }
}

// id = null forgets every open alert
function forgetOpen(open, id) {
  for (const [type, entry] of open) if (id == null || entry.id === id) open.delete(type)
}

export function useAlerts() {
  const [items, setItems] = useState([])
  const [toast, setToast] = useState(null)
  // fault_type -> { id, lastAt } for detector alerts that are still unacknowledged
  const openRef = useRef(new Map())

  // Accepts a detector message ({type: 'anomaly', ...}) or a manual trigger.
  // Anything the message leaves out is filled from the fault type's config.
  const push = useCallback((incoming) => {
    const known = FAULT_TYPES.find((f) => f.type === incoming.fault_type)
    const timestamp = incoming.timestamp ?? new Date().toISOString()
    const alert = {
      id: nextId++,
      timestamp,
      lastTimestamp: timestamp,
      count: 1,
      fault_type: incoming.fault_type ?? 'ANOMALY',
      severity: incoming.severity ?? known?.severity ?? 'HIGH',
      confidence: incoming.confidence ?? null,
      anomaly_score: incoming.anomaly_score ?? null,
      model_prediction: incoming.model_prediction ?? null,
      description: incoming.description ?? known?.description ?? 'Unusual sensor window detected',
      sensors: incoming.sensors ?? known?.sensors ?? [],
      source: incoming.source ?? 'detector',
      acknowledged: false,
    }

    // Manual test alerts always stand alone
    const groupable = alert.source !== 'manual'
    const now = Date.now()
    const open = groupable ? openRef.current.get(alert.fault_type) : null

    if (open && now - open.lastAt <= REPEAT_WINDOW_MS) {
      open.lastAt = now
      setItems((prev) => prev.map((a) => (a.id === open.id ? mergeRepeat(a, alert) : a)))
      return
    }

    if (groupable) openRef.current.set(alert.fault_type, { id: alert.id, lastAt: now })
    setItems((prev) => [alert, ...prev].slice(0, MAX_ALERTS))
    setToast(alert)
  }, [])

  const trigger = useCallback(
    (type) => {
      const fault = FAULT_TYPES.find((f) => f.type === type) ?? FAULT_TYPES[0]
      push({
        fault_type: fault.type,
        severity: fault.severity,
        description: fault.description,
        sensors: fault.sensors,
        confidence: 0.82 + Math.random() * 0.15,
        source: 'manual',
      })
    },
    [push],
  )

  // Once acknowledged, the same fault showing up again raises a fresh alert
  const acknowledge = useCallback((id) => {
    forgetOpen(openRef.current, id)
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)))
  }, [])

  const acknowledgeAll = useCallback(() => {
    forgetOpen(openRef.current, null)
    setItems((prev) => prev.map((a) => ({ ...a, acknowledged: true })))
  }, [])

  const clear = useCallback(() => {
    forgetOpen(openRef.current, null)
    setItems([])
    setToast(null)
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  return { items, toast, push, trigger, acknowledge, acknowledgeAll, clear, dismissToast }
}
