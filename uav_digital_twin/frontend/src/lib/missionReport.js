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

export const SENSOR_LABELS = {
  rpm: 'RPM',
  cht: 'CHT',
  egt: 'EGT',
  oil_pressure: 'Oil pressure',
  oil_temperature: 'Oil temperature',
  fuel_flow: 'Fuel flow',
  vibration: 'Vibration',
  battery_voltage: 'Battery voltage',
  alternator_current: 'Alternator current',
  injection_timing: 'Injection timing',
}

function getValue(reading, key) {
  const value = reading?.values?.[key]

  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null
}

export function sensorStatistics(readings = []) {
  return Object.fromEntries(
    SENSOR_KEYS.map((key) => {
      const values = readings
        .map((reading) => getValue(reading, key))
        .filter((value) => value !== null)

      if (values.length === 0) {
        return [
          key,
          {
            min: null,
            average: null,
            max: null,
          },
        ]
      }

      const min = Math.min(...values)
      const max = Math.max(...values)

      const average =
        values.reduce(
          (sum, value) => sum + value,
          0,
        ) / values.length

      return [
        key,
        {
          min,
          average,
          max,
        },
      ]
    }),
  )
}

export function missionDuration(readings = []) {
  if (readings.length < 2) {
    return 0
  }

  const first = readings[0]?.time
  const last = readings[readings.length - 1]?.time

  if (
    typeof first !== 'number' ||
    typeof last !== 'number'
  ) {
    return 0
  }

  return Math.max(0, last - first)
}

export function missionReadings(readings = []) {
  return {
    count: readings.length,
    durationMs: missionDuration(readings),
    statistics: sensorStatistics(readings),
  }
}

export function formatDuration(durationMs) {
  if (
    typeof durationMs !== 'number' ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return '0 s'
  }

  const totalSeconds = Math.round(
    durationMs / 1000,
  )

  const hours = Math.floor(
    totalSeconds / 3600,
  )

  const minutes = Math.floor(
    (totalSeconds % 3600) / 60,
  )

  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours} h ${minutes} min`
  }

  if (minutes > 0) {
    return `${minutes} min ${seconds} s`
  }

  return `${seconds} s`
}