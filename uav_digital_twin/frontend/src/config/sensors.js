// One entry per value sensor_simulator.py sends.
//
// `limits` drive every colour on the dashboard:
//   between warnLow and warnHigh  -> NORMAL  (green)
//   past warnLow / warnHigh       -> CAUTION (amber)
//   past critLow / critHigh       -> ALERT   (red)
// Leave a limit out if that side can't go wrong.
//
// Where the backend already has a threshold (main.py -> /engine-health) the same
// number is used here so the gauges and the backend agree. Limits marked
// "frontend only" have no backend rule yet - tune them freely.
export const SENSORS = [
  {
    key: 'rpm',
    code: 'RPM',
    label: 'Engine speed',
    unit: 'rpm',
    min: 1500,
    max: 3500,
    decimals: 0,
    primary: true,
    // frontend only (backend's misfire rule uses rpm < 2600). Wide enough for every
    // flight phase in sensor_simulator.py: descent 2450 ... takeoff 3100.
    limits: { critLow: 2200, warnLow: 2350, warnHigh: 3200, critHigh: 3350 },
  },
  {
    key: 'cht',
    code: 'CHT',
    label: 'Cylinder head',
    unit: '°C',
    min: 100,
    max: 260,
    decimals: 1,
    primary: true,
    limits: { warnHigh: 205, critHigh: 220 },
  },
  {
    key: 'oil_pressure',
    code: 'OIL P',
    label: 'Oil pressure',
    unit: 'psi',
    min: 0,
    max: 80,
    decimals: 1,
    primary: true,
    limits: { critLow: 25, warnLow: 30 },
  },
  {
    key: 'fuel_flow',
    code: 'FUEL',
    label: 'Fuel flow',
    unit: 'L/h',
    min: 0,
    max: 22,
    decimals: 1,
    primary: true,
    limits: { warnHigh: 15, critHigh: 17 },
  },
  {
    key: 'vibration',
    code: 'VIB',
    label: 'Vibration',
    unit: 'g',
    min: 0,
    max: 2,
    decimals: 2,
    primary: true,
    limits: { warnHigh: 0.7, critHigh: 1.0 },
  },
  {
    key: 'egt',
    code: 'EGT',
    label: 'Exhaust gas',
    unit: '°C',
    min: 500,
    max: 900,
    decimals: 0,
    limits: { warnHigh: 780, critHigh: 830 },
  },
  {
    key: 'oil_temperature',
    code: 'OIL T',
    label: 'Oil temp',
    unit: '°C',
    min: 40,
    max: 130,
    decimals: 1,
    // critHigh matches the backend overheating rule; warnHigh is frontend only
    limits: { warnHigh: 100, critHigh: 105 },
  },
  {
    key: 'battery_voltage',
    code: 'BATT',
    label: 'Battery voltage',
    unit: 'V',
    min: 18,
    max: 30,
    decimals: 2,
    limits: { critLow: 21, warnLow: 22.5 },
  },
  {
    key: 'alternator_current',
    code: 'ALT',
    label: 'Alternator',
    unit: 'A',
    min: 0,
    max: 15,
    decimals: 1,
    limits: { critLow: 4, warnLow: 5 },
  },
  {
    key: 'injection_timing',
    code: 'INJ',
    label: 'Injection timing',
    unit: '° BTDC',
    min: 6,
    max: 18,
    decimals: 1,
    // frontend only
    limits: { critLow: 10, warnLow: 11, warnHigh: 13, critHigh: 14 },
  },
]

export const SENSOR_BY_KEY = Object.fromEntries(SENSORS.map((s) => [s.key, s]))

// Limit lines drawn on charts
export const LIMIT_LINES = [
  { key: 'critLow', tone: 'critical' },
  { key: 'warnLow', tone: 'warning' },
  { key: 'warnHigh', tone: 'warning' },
  { key: 'critHigh', tone: 'critical' },
]

export const STATUS_META = {
  nodata: { label: 'No signal', rank: -1 },
  normal: { label: 'Normal', rank: 0 },
  warning: { label: 'Caution', rank: 1 },
  critical: { label: 'Alert', rank: 2 },
}

export function sensorStatus(sensor, value) {
  if (value == null || !Number.isFinite(value)) return 'nodata'
  const { critLow, warnLow, warnHigh, critHigh } = sensor.limits
  if ((critLow != null && value < critLow) || (critHigh != null && value > critHigh)) return 'critical'
  if ((warnLow != null && value < warnLow) || (warnHigh != null && value > warnHigh)) return 'warning'
  return 'normal'
}

export function worstStatus(statuses) {
  return statuses.reduce(
    (worst, s) => (STATUS_META[s].rank > STATUS_META[worst].rank ? s : worst),
    'nodata',
  )
}

// Splits the gauge range into coloured bands, e.g. CHT ->
//   [100-205 normal] [205-220 warning] [220-260 critical]
export function sensorZones(sensor) {
  const { min, max, limits } = sensor
  const zones = []
  let lo = min
  if (limits.critLow != null) {
    zones.push({ from: lo, to: limits.critLow, status: 'critical' })
    lo = limits.critLow
  }
  if (limits.warnLow != null) {
    zones.push({ from: lo, to: limits.warnLow, status: 'warning' })
    lo = limits.warnLow
  }

  const upper = []
  let hi = max
  if (limits.critHigh != null) {
    upper.unshift({ from: limits.critHigh, to: hi, status: 'critical' })
    hi = limits.critHigh
  }
  if (limits.warnHigh != null) {
    upper.unshift({ from: limits.warnHigh, to: hi, status: 'warning' })
    hi = limits.warnHigh
  }

  return [...zones, { from: lo, to: hi, status: 'normal' }, ...upper]
}
