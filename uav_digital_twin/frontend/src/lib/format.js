export function formatValue(sensor, value) {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: sensor.decimals,
    maximumFractionDigits: sensor.decimals,
  })
}

// 24-hour local clock, e.g. 14:32:07
export function formatClock(timestamp) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString('en-GB', { hour12: false })
}
