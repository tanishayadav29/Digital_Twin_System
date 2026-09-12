// Fault types the ML detector can report. The `type` values match the fault_type
// strings ML/fault_detector.py returns. Backend alerts carry their own severity
// and sensors; `title` and `description` always come from here. The manual test
// trigger raises these too.
export const FAULT_TYPES = [
  {
    type: 'OVERHEATING',
    title: 'Overheating',
    severity: 'HIGH',
    sensors: ['cht', 'egt', 'oil_temperature'],
    description: 'Engine temperatures above safe limits',
  },
  {
    type: 'LUBRICATION_ISSUE',
    title: 'Lubrication issue',
    severity: 'CRITICAL',
    sensors: ['oil_pressure'],
    description: 'Oil pressure below safe range',
  },
  {
    type: 'MISFIRE',
    title: 'Misfire',
    severity: 'HIGH',
    sensors: ['rpm', 'vibration', 'egt'],
    description: 'RPM drop with vibration spike and low EGT',
  },
  {
    type: 'ABNORMAL_VIBRATION',
    title: 'Abnormal vibration',
    severity: 'HIGH',
    sensors: ['vibration'],
    description: 'Engine vibration abnormally high',
  },
  {
    type: 'INJECTOR_ABNORMALITY',
    title: 'Injector abnormality',
    severity: 'HIGH',
    sensors: ['fuel_flow', 'injection_timing'],
    description: 'High fuel flow with injection timing off nominal',
  },
  {
    type: 'COMBUSTION_INSTABILITY',
    title: 'Combustion instability',
    severity: 'HIGH',
    sensors: ['vibration', 'egt', 'rpm'],
    description: 'Vibration with unstable EGT at reduced RPM',
  },
  {
    type: 'ELECTRICAL_FAULT',
    title: 'Electrical fault',
    severity: 'MEDIUM',
    sensors: ['battery_voltage', 'alternator_current'],
    description: 'Charging system output degraded',
  },
  {
    type: 'SENSOR_DRIFT_FAILURE',
    title: 'Sensor drift / failure',
    severity: 'MEDIUM',
    sensors: [],
    description: 'Sensor reading missing or outside its physical range',
  },
  {
    type: 'UNKNOWN_ANOMALY',
    title: 'Unknown anomaly',
    severity: 'MEDIUM',
    sensors: [],
    description: 'Isolation Forest flagged an unusual sensor pattern',
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
