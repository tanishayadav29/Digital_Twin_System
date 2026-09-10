// Fault types the manual test trigger can raise. The `type` values match the
// fault_type strings the backend already uses (main.py -> detect_fault), so the
// panel will render real detector output the same way.
export const FAULT_TYPES = [
  {
    type: 'OVERHEATING',
    title: 'Overheating',
    severity: 'HIGH',
    sensors: ['cht', 'egt', 'oil_temperature'],
    description: 'CHT trending abnormally high',
  },
  {
    type: 'MISFIRE',
    title: 'Misfire',
    severity: 'HIGH',
    sensors: ['vibration', 'rpm'],
    description: 'Sharp vibration spikes with RPM drop',
  },
  {
    type: 'LOW_OIL_PRESSURE',
    title: 'Low oil pressure',
    severity: 'CRITICAL',
    sensors: ['oil_pressure'],
    description: 'Oil pressure falling below safe range',
  },
  {
    type: 'HIGH_VIBRATION',
    title: 'High vibration',
    severity: 'MEDIUM',
    sensors: ['vibration'],
    description: 'Sustained abnormal vibration level',
  },
  {
    type: 'FUEL_ANOMALY',
    title: 'Fuel flow anomaly',
    severity: 'MEDIUM',
    sensors: ['fuel_flow'],
    description: 'Fuel flow deviating from normal pattern',
  },
  {
    type: 'ELECTRICAL_FAULT',
    title: 'Electrical fault',
    severity: 'MEDIUM',
    sensors: ['battery_voltage', 'alternator_current'],
    description: 'Charging system output degraded',
  },
]

export const SEVERITY_META = {
  MEDIUM: { label: 'Medium', tone: 'warning' },
  HIGH: { label: 'High', tone: 'serious' },
  CRITICAL: { label: 'Critical', tone: 'critical' },
}

export function faultTitle(type) {
  const known = FAULT_TYPES.find((f) => f.type === type)
  if (known) return known.title
  const words = String(type ?? 'Anomaly').toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
