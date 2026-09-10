import { useEffect } from 'react'
import { faultTitle } from '../config/faults.js'
import { formatClock } from '../lib/format.js'

const TOAST_MS = 6000

// Pop-up for a new alert. Render with key={alert.id} so each new alert replays
// the entrance animation and restarts the timer.
export function AlertToast({ alert, onDismiss, onOpen }) {
  useEffect(() => {
    if (!alert) return
    const timer = setTimeout(onDismiss, TOAST_MS)
    return () => clearTimeout(timer)
  }, [alert, onDismiss])

  if (!alert) return null

  return (
    <div className="toast" role="alert">
      <svg className="toast__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M12 2.5 1.3 21h21.4L12 2.5ZM11 9h2v6.2h-2V9Zm0 8.2h2v2h-2v-2Z"
        />
      </svg>
      <button type="button" className="toast__body" onClick={onOpen}>
        <span className="toast__title">{faultTitle(alert.fault_type)} detected</span>
        <span className="toast__desc">
          {formatClock(alert.timestamp)} — {alert.description}
        </span>
      </button>
      <button type="button" className="toast__close" aria-label="Dismiss alert" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
