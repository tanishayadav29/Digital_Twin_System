// Small chart maths shared by the trend and relationship charts.

export function linear([d0, d1], [r0, r1]) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  return (value) => r0 + (value - d0) * k
}

// Value domain for one sensor axis: the data plus its caution limits (so the
// reader sees how much headroom is left), never narrower than 12% of the gauge
// range so normal sensor noise doesn't look like a big swing.
export function sensorDomain(sensor, values) {
  const points = values.filter((v) => v != null && Number.isFinite(v))
  const { warnLow, warnHigh } = sensor.limits
  if (warnLow != null) points.push(warnLow)
  if (warnHigh != null) points.push(warnHigh)

  let lo = points.length ? Math.min(...points) : sensor.min
  let hi = points.length ? Math.max(...points) : sensor.max
  const minSpan = (sensor.max - sensor.min) * 0.12
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2
    lo = mid - minSpan / 2
    hi = mid + minSpan / 2
  }
  const pad = (hi - lo) * 0.08
  return [lo - pad, hi + pad]
}

// Round tick values (1 / 2 / 5 × 10^n steps) inside [lo, hi]
export function niceTicks(lo, hi, count = 4) {
  const span = hi - lo
  if (!(span > 0)) return { ticks: [lo], step: 1 }
  const raw = span / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / magnitude
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude
  const ticks = []
  for (let i = Math.ceil(lo / step); i * step <= hi + step * 1e-9; i++) ticks.push(i * step)
  return { ticks, step }
}

export function formatTick(value, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

const TIME_STEPS = [5, 10, 15, 30, 60, 120, 180, 300, 600].map((s) => s * 1000)

export function timeTicks(start, end, pixelWidth) {
  const maxTicks = Math.max(2, Math.floor(pixelWidth / 80))
  const step = TIME_STEPS.find((s) => (end - start) / s <= maxTicks) ?? TIME_STEPS.at(-1)
  const ticks = []
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push(t)
  return { ticks, step }
}

export function formatTimeTick(time, step) {
  const options = step < 60_000 ? { hour12: false } : { hour: '2-digit', minute: '2-digit', hour12: false }
  return new Date(time).toLocaleTimeString('en-GB', options)
}

// Pearson correlation, or null when there's too little variation to say
export function pearson(xs, ys) {
  const n = xs.length
  if (n < 3) return null
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += xs[i]
    my += ys[i]
  }
  mx /= n
  my /= n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

// A circle as path data, so hundreds of dots can share one <path>
export function dotPath(x, y, r) {
  return `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
}

// Index of the reading closest in time (readings sorted by .time)
export function nearestIndex(readings, time) {
  if (!readings.length) return -1
  let lo = 0
  let hi = readings.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (readings[mid].time < time) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && time - readings[lo - 1].time < readings[lo].time - time) return lo - 1
  return lo
}
