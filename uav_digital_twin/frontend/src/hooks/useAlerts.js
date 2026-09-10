import { useCallback, useState } from 'react'
import { FAULT_TYPES } from '../config/faults.js'

const MAX_ALERTS = 50
let nextId = 1

export function useAlerts() {
  const [items, setItems] = useState([])
  const [toast, setToast] = useState(null)

  // Accepts a detector message ({type: 'anomaly', ...}) or a manual trigger
  const push = useCallback((incoming) => {
    const alert = {
      id: nextId++,
      timestamp: incoming.timestamp ?? new Date().toISOString(),
      fault_type: incoming.fault_type ?? 'ANOMALY',
      severity: incoming.severity ?? 'HIGH',
      confidence: incoming.confidence ?? null,
      description: incoming.description ?? 'Unusual sensor window detected',
      sensors: incoming.sensors ?? [],
      source: incoming.source ?? 'detector',
      acknowledged: false,
    }
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

  const acknowledge = useCallback((id) => {
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)))
  }, [])

  const acknowledgeAll = useCallback(() => {
    setItems((prev) => prev.map((a) => ({ ...a, acknowledged: true })))
  }, [])

  const clear = useCallback(() => {
    setItems([])
    setToast(null)
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  return { items, toast, push, trigger, acknowledge, acknowledgeAll, clear, dismissToast }
}
