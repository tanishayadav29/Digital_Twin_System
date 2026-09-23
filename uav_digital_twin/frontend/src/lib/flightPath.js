// Flight reconstruction for the replay view.
//
// IMPORTANT, and stated on screen too: the database records engine parameters
// only - no GPS, no altitude, no attitude (see models.py). So a flight cannot
// be replayed from it. What the UAV does on screen is *reconstructed* from the
// readings that were recorded.
//
// The reconstruction is not guesswork. sensor_simulator.py produces every
// reading from an explicit flight-phase model whose RPM setpoints are 150-300
// apart, while RPM measurement noise is about 12 rpm. The phase that produced a
// reading is therefore recoverable from its RPM, and the phase is what sets
// climb rate and airspeed. Everything below is deterministic: the same readings
// always produce the same flight, so a given timestamp always looks the same.
//
// Nothing here feeds the fault detector. ML/engine_features.py has its own
// fixed SENSOR_KEYS list and never sees any of this.

// RPM setpoints copied from sensor_simulator.py PHASES. Climb rate and speed
// are the flight model those setpoints imply for a MALE UAV.
export const PHASES = {
  TAKEOFF: { rpm: 3100, climb: 6.5, speed: 20, label: 'Takeoff', tone: 'warning' },
  CLIMB: { rpm: 2950, climb: 3.6, speed: 26, label: 'Climb', tone: 'normal' },
  CRUISE: { rpm: 2800, climb: 0, speed: 38, label: 'Cruise', tone: 'normal' },
  LOITER: { rpm: 2650, climb: 0, speed: 26, label: 'Loiter', tone: 'normal' },
  DESCENT: { rpm: 2450, climb: -3.4, speed: 32, label: 'Descent', tone: 'normal' },
}

const PHASE_LIST = Object.entries(PHASES)

// Blocks on the site stand roughly 30-115 m. The altitude band is deliberately
// pinned just over that: high enough to clear a climb, low enough that the
// aircraft stays among the buildings instead of cruising over the top of them,
// which is the whole point of showing obstacles.
export const ALT_MIN = 30
export const ALT_MAX = 135
const ALT_START = 72

// A reading gap longer than this is a break in the recording, not a long
// cruise - don't integrate across it or the UAV teleports.
const MAX_STEP_S = 5

/**
 * Which flight phase produced this RPM. Nearest setpoint wins; the bands are
 * ~150 rpm wide against ~12 rpm of noise, so this is stable reading to reading.
 * Returns null when there is no RPM, and the caller holds the previous phase.
 */
export function classifyPhase(rpm) {
  if (typeof rpm !== 'number' || !Number.isFinite(rpm)) return null

  let best = null
  let bestGap = Infinity
  for (const [name, spec] of PHASE_LIST) {
    const gap = Math.abs(rpm - spec.rpm)
    if (gap < bestGap) {
      bestGap = gap
      best = name
    }
  }
  return best
}

/**
 * Turns a run of readings into flight frames.
 *
 * Each frame carries where the aircraft is along the route (`distance`, in
 * metres from the start of the window) and how it is flying, so the 3D scene
 * only has to map distance onto its curve.
 *
 * `distance` and `altitude` are integrated, which is why the whole window is
 * rebuilt at once rather than frame by frame: it keeps replay and live mode
 * identical and free of drift.
 */
export function reconstructFlight(readings) {
  const frames = []
  if (!readings?.length) return frames

  let altitude = ALT_START
  let distance = 0
  let phase = 'CRUISE'

  for (let i = 0; i < readings.length; i++) {
    const reading = readings[i]
    const detected = classifyPhase(reading.values?.rpm)
    if (detected) phase = detected

    const spec = PHASES[phase]
    const dt = i === 0 ? 0 : Math.min(Math.max((reading.time - readings[i - 1].time) / 1000, 0), MAX_STEP_S)

    // Speed follows the phase, nudged by how far RPM sits from its setpoint, so
    // a sagging engine visibly slows down instead of cruising through a fault.
    const rpm = reading.values?.rpm
    const trim = typeof rpm === 'number' ? (rpm - spec.rpm) / 400 : 0
    const speed = Math.max(12, spec.speed * (1 + Math.max(-0.35, Math.min(0.2, trim))))

    const climb = spec.climb
    altitude = Math.min(ALT_MAX, Math.max(ALT_MIN, altitude + climb * dt))
    distance += speed * dt

    frames.push({
      time: reading.time,
      phase,
      speed,
      climb: altitude <= ALT_MIN || altitude >= ALT_MAX ? 0 : climb,
      altitude,
      distance,
      vibration: reading.values?.vibration ?? 0,
    })
  }

  return frames
}

// Linear interpolation between the two frames either side of `time`, so the
// aircraft moves smoothly instead of stepping once a second.
export function frameAt(frames, time) {
  if (!frames.length) return null
  if (time <= frames[0].time) return frames[0]
  if (time >= frames[frames.length - 1].time) return frames[frames.length - 1]

  let lo = 0
  let hi = frames.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (frames[mid].time <= time) lo = mid
    else hi = mid
  }

  const a = frames[lo]
  const b = frames[hi]
  const span = b.time - a.time
  const t = span > 0 ? (time - a.time) / span : 0

  return {
    time,
    phase: t < 0.5 ? a.phase : b.phase,
    speed: a.speed + (b.speed - a.speed) * t,
    climb: a.climb + (b.climb - a.climb) * t,
    altitude: a.altitude + (b.altitude - a.altitude) * t,
    distance: a.distance + (b.distance - a.distance) * t,
    vibration: a.vibration + (b.vibration - a.vibration) * t,
  }
}

// Headline numbers for the panel under the scene.
export function flightSummary(frames) {
  if (!frames.length) return null

  let lowest = Infinity
  let highest = -Infinity
  const seconds = {}

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    lowest = Math.min(lowest, f.altitude)
    highest = Math.max(highest, f.altitude)
    const dt = i === 0 ? 0 : Math.min(Math.max((f.time - frames[i - 1].time) / 1000, 0), MAX_STEP_S)
    seconds[f.phase] = (seconds[f.phase] ?? 0) + dt
  }

  const total = frames[frames.length - 1].time - frames[0].time

  return {
    readings: frames.length,
    durationMs: total,
    distance: frames[frames.length - 1].distance,
    lowest,
    highest,
    phases: Object.entries(seconds)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, s]) => ({ name, label: PHASES[name].label, seconds: s })),
  }
}
