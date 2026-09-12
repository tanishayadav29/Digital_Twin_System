// In-browser copy of sensor_simulator.py, used by the "Simulated" source so the
// dashboard can be developed and demoed without the backend running. Same flight
// phases, engine relationships, noise and fault episodes as the Python script -
// change both together. See sensor_simulator.py for the reasoning behind the numbers.

const SENSOR_KEYS = [
  'rpm',
  'cht',
  'egt',
  'oil_pressure',
  'oil_temperature',
  'fuel_flow',
  'vibration',
  'battery_voltage',
  'alternator_current',
  'injection_timing',
]

const PHASES = {
  TAKEOFF: { rpm: 3100, cooling: 0 },
  CLIMB: { rpm: 2950, cooling: 4 },
  CRUISE: { rpm: 2800, cooling: 0 },
  LOITER: { rpm: 2650, cooling: 1 },
  DESCENT: { rpm: 2450, cooling: -4 },
}

const MISSION_START = [['TAKEOFF', 60], ['CLIMB', 240]]
const MISSION_LOOP = [['CRUISE', 600], ['LOITER', 420], ['DESCENT', 120], ['LOITER', 300], ['CLIMB', 180]]

const NOISE = {
  rpm: 12,
  cht: 0.6,
  egt: 3,
  oil_pressure: 0.6,
  oil_temperature: 0.4,
  fuel_flow: 0.12,
  vibration: 0.015,
  battery_voltage: 0.08,
  alternator_current: 0.15,
  injection_timing: 0.1,
}

// Sensor shift at full severity
const FAULTS = {
  OVERHEATING: { cht: 55, egt: 70, oil_temperature: 22, oil_pressure: -4 },
  LUBRICATION_ISSUE: { oil_pressure: -22, oil_temperature: 12, vibration: 0.12, cht: 4 },
  MISFIRE: { rpm: -300, egt: -90, vibration: 0.6 },
  ABNORMAL_VIBRATION: { vibration: 0.8 },
  INJECTOR_ABNORMALITY: { fuel_flow: 5.5, injection_timing: 2.4, egt: -40, cht: -4, rpm: -60 },
  COMBUSTION_INSTABILITY: { rpm: -150, egt: -100, vibration: 0.4 },
  ELECTRICAL_FAULT: { alternator_current: -5.2, battery_voltage: -2.6 },
  SENSOR_DRIFT_FAILURE: {},
}

const FAULT_RAMP = [150, 240]
const FAULT_HOLD = [60, 120]
const FAULT_RECOVERY = [45, 90]
const FAULT_GAP = [180, 360]

const uniform = (a, b) => a + Math.random() * (b - a)
const gauss = (sd) => sd * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())
const round3 = (v) => Math.round(v * 1000) / 1000
const lag = (current, target, tau, dt) => (current == null ? target : current + (target - current) * (1 - Math.exp(-dt / tau)))
// Mean-reverting random walk with long-run standard deviation sd
const wander = (value, sd, tau, dt) => value - (value * dt) / tau + sd * Math.sqrt((2 * dt) / tau) * gauss(1)

function phaseAt(profile, clock) {
  if (profile === 'cruise') return 'CRUISE'
  let t = clock
  for (const [name, duration] of MISSION_START) {
    if (t < duration) return name
    t -= duration
  }
  t %= MISSION_LOOP.reduce((sum, [, duration]) => sum + duration, 0)
  for (const [name, duration] of MISSION_LOOP) {
    if (t < duration) return name
    t -= duration
  }
}

function episodeProgress(episode, now) {
  let elapsed = now - episode.start
  if (elapsed < episode.ramp) return ['DEVELOPING', (elapsed / episode.ramp) ** 1.5]
  elapsed -= episode.ramp
  if (elapsed < episode.hold) return ['ACTIVE', 1]
  elapsed -= episode.hold
  if (elapsed < episode.recovery) return ['RECOVERING', 1 - elapsed / episode.recovery]
  return [null, 0]
}

/**
 * Returns next(dt = 1) -> one reading, advancing the engine dt simulated seconds.
 * profile: 'cruise' (default, what the ML model was trained on) | 'mission'
 */
export function createSimulator({ profile = 'cruise', faultAfter = 120 } = {}) {
  let time = 0
  let missionClock = 0 // paused during a fault episode
  let episode = null
  let nextFaultAt = faultAfter

  let ambient = 0
  let load = 0
  let rpmWander = 0

  let rpm = PHASES[phaseAt(profile, 0)].rpm
  let cht = null
  let oilTemperature = null

  function updateFault(phase) {
    if (!episode) {
      if (time < nextFaultAt || (phase !== 'CRUISE' && phase !== 'LOITER')) return [null, null, 0]
      const types = Object.keys(FAULTS)
      episode = {
        fault: types[Math.floor(Math.random() * types.length)],
        start: time,
        ramp: uniform(...FAULT_RAMP),
        hold: uniform(...FAULT_HOLD),
        recovery: uniform(...FAULT_RECOVERY),
      }
    }
    const [stage, severity] = episodeProgress(episode, time)
    if (!stage) {
      episode = null
      nextFaultAt = time + uniform(...FAULT_GAP)
      return [null, null, 0]
    }
    return [episode.fault, stage, severity]
  }

  function faultEffects(fault, s) {
    const fx = Object.fromEntries(SENSOR_KEYS.map((key) => [key, 0]))
    if (!fault) return fx
    for (const [key, peak] of Object.entries(FAULTS[fault])) fx[key] = peak * s

    if (fault === 'MISFIRE') {
      if (Math.random() < 0.15 + 0.5 * s) {
        fx.vibration += uniform(0.1, 0.4) * s
        fx.rpm -= uniform(50, 150) * s
      }
    } else if (fault === 'COMBUSTION_INSTABILITY') {
      fx.egt += 25 * s * Math.sin((2 * Math.PI * time) / 7)
      fx.rpm += 40 * s * Math.sin((2 * Math.PI * time) / 5)
      fx.vibration += 0.03 * s * Math.abs(gauss(1))
    } else if (fault === 'ABNORMAL_VIBRATION') {
      fx.rpm += 20 * s * Math.sin((2 * Math.PI * time) / 3)
    } else if (fault === 'ELECTRICAL_FAULT') {
      fx.alternator_current += gauss(0.4 * s)
    }
    return fx
  }

  return function next(dt = 1) {
    time += dt
    if (!episode) missionClock += dt

    const phase = phaseAt(profile, missionClock)
    const spec = PHASES[phase]
    const [fault, stage, severity] = updateFault(phase)
    const fx = faultEffects(fault, severity)

    ambient = wander(ambient, 1, 400, dt)
    load = wander(load, 0.3, 120, dt)
    rpmWander = wander(rpmWander, 10, 30, dt)

    rpm = lag(rpm, spec.rpm + rpmWander, 6, dt)
    const r = (rpm - 2800) / 100
    cht = lag(cht, 185 + 5 * r + spec.cooling + 0.8 * ambient + fx.cht, 60, dt)
    oilTemperature = lag(oilTemperature, 90 + 1.5 * r + 0.5 * ambient + fx.oil_temperature, 150, dt)

    const actual = {
      rpm: rpm + fx.rpm,
      cht,
      egt: 720 + 12 * r + 2 * ambient + fx.egt,
      oil_pressure: 45 + 1.2 * r - 0.25 * (oilTemperature - 90) + fx.oil_pressure,
      oil_temperature: oilTemperature,
      fuel_flow: 12 + 0.9 * r + fx.fuel_flow,
      vibration: 0.3 + 0.025 * r + fx.vibration,
      battery_voltage: 24.5 + 0.1 * load + fx.battery_voltage,
      alternator_current: 8 + 0.15 * r + load + fx.alternator_current,
      injection_timing: 12 + 0.15 * r + fx.injection_timing,
    }

    const reading = Object.fromEntries(SENSOR_KEYS.map((key) => [key, round3(actual[key] + gauss(NOISE[key]))]))

    if (fault === 'SENSOR_DRIFT_FAILURE') {
      // Engine is fine; the CHT sensor drifts low, then drops out
      reading.cht = round3(reading.cht - 90 * severity)
      const dropoutChance = stage === 'ACTIVE' ? 0.7 : severity > 0.85 ? 0.2 : 0
      if (Math.random() < dropoutChance) reading.cht = null
    }

    return { engine_id: 'SIMULATED', timestamp: new Date().toISOString(), ...reading }
  }
}
