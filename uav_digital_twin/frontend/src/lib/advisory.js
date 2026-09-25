import { adviceFor, ALIASES } from '../config/maintenance.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const HEALTH_LEVELS = {
  CRITICAL: 0.3,
  HIGH: 0.5,
  MEDIUM: 0.7,
}

function normalizeFaultType(faultType) {
  return ALIASES[faultType] ?? faultType
}

function healthPriority(health) {
  if (health == null || !Number.isFinite(health)) return null

  if (health < HEALTH_LEVELS.CRITICAL) return 'CRITICAL'
  if (health < HEALTH_LEVELS.HIGH) return 'HIGH'
  if (health < HEALTH_LEVELS.MEDIUM) return 'MEDIUM'

  return 'LOW'
}

function rulPriority(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return null

  if (seconds <= 10) return 'CRITICAL'
  if (seconds <= 60) return 'HIGH'
  if (seconds <= 300) return 'MEDIUM'

  return 'LOW'
}

const PRIORITY_ORDER = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
}

function higherPriority(a, b) {
  if (!a) return b
  if (!b) return a

  return PRIORITY_ORDER[a] >= PRIORITY_ORDER[b] ? a : b
}

export function advisoryPriority({ health, rulSeconds, severity }) {
  const fromHealth = healthPriority(health)
  const fromRul = rulPriority(rulSeconds)

  let priority = higherPriority(fromHealth, fromRul)

  if (severity) {
    const normalizedSeverity = String(severity).toUpperCase()

    if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalizedSeverity)) {
      priority = higherPriority(priority, normalizedSeverity)
    }
  }

  return priority ?? 'LOW'
}

export function generateAdvisory({
  faultType,
  severity,
  health = null,
  rulSeconds = null,
  occurrences = 1,
  affectedParts = [],
  active = true,
}) {
  const normalizedFault = normalizeFaultType(faultType)
  const advice = adviceFor(faultType)

  const priority = advisoryPriority({
    health,
    rulSeconds,
    severity,
  })

  const healthPercent =
    typeof health === 'number'
      ? Math.round(clamp(health, 0, 1) * 100)
      : null

  return {
    faultType,
    normalizedFault,
    severity: priority,

    active,
    occurrences,

    health: healthPercent,
    rulSeconds,

    affectedParts,

    summary: advice.summary,
    immediateActions: advice.now,
    inspectionActions: advice.inspect,
    preventiveActions: advice.prevent,
  }
}