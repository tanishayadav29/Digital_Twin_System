// Maintenance advice per fault type, shown on the Maintenance advisory tab.
//
// Keys match the fault_type strings the detector produces (ML/fault_detector.py).
//   summary - one plain line: what is wrong
//   now     - what to do while it is happening (first item is shown up front)
//   inspect - what to check on the ground
//   prevent - recurring tasks that stop it coming back, with an interval
//
// Keep every line short - this is read at a glance, not studied. Generic guidance
// for a MALE UAV aero piston engine; where the engine manual differs, follow the manual.

export const INTERVAL_ORDER = [
  'Before each flight',
  'Every 25 h',
  'Every 50 h',
  'Every 100 h',
  'Every 200 h',
  'Every 6 months',
]

// Fault names from detector v1 that mean the same thing as a v2 name
export const ALIASES = {
  LOW_OIL_PRESSURE: 'LUBRICATION_ISSUE',
  HIGH_VIBRATION: 'ABNORMAL_VIBRATION',
  FUEL_ANOMALY: 'INJECTOR_ABNORMALITY',
}

export const ADVICE = {
  OVERHEATING: {
    summary: 'The engine is running hotter than it should.',
    now: [
      'Reduce power and enrich the mixture',
      'Descend or level off for more cooling air',
      'Land soon if CHT keeps climbing',
    ],
    inspect: [
      'Check cowling inlets and baffle seals',
      'Clean the oil cooler core',
      'Look for exhaust leaks at the cylinder head',
      'Check the CHT sensor against a reference',
    ],
    prevent: [
      { every: 'Every 25 h', do: 'Clean cowling inlets and oil cooler' },
      { every: 'Every 100 h', do: 'Replace hardened baffle seals' },
      { every: 'Before each flight', do: 'Log cruise CHT and watch the trend' },
    ],
  },

  LUBRICATION_ISSUE: {
    summary: 'Oil pressure is falling — lubrication is at risk.',
    now: [
      'Land as soon as practical',
      'Reduce power and avoid high RPM',
      'Check whether oil temperature is rising too',
    ],
    inspect: [
      'Check oil level and look for leaks',
      'Replace the filter and check it for metal',
      'Send an oil sample for analysis',
      'Verify pressure with a master gauge',
    ],
    prevent: [
      { every: 'Before each flight', do: 'Check oil level and log consumption' },
      { every: 'Every 50 h', do: 'Change oil and filter, sample for analysis' },
      { every: 'Every 200 h', do: 'Replace oil hoses at calendar life' },
    ],
  },

  MISFIRE: {
    summary: 'A cylinder is not firing cleanly.',
    now: [
      'Check each ignition circuit, note the RPM drop',
      'Adjust the mixture to clear a fouled plug',
      'Land if vibration or RPM loss continues',
    ],
    inspect: [
      'Clean and re-gap the plugs, replace worn ones',
      'Check plug leads for resistance and chafing',
      'Compression-test the affected cylinder',
      'Check fuel delivery to that cylinder',
    ],
    prevent: [
      { every: 'Every 25 h', do: 'Rotate, clean and re-gap spark plugs' },
      { every: 'Every 100 h', do: 'Replace plugs, check lead resistance' },
      { every: 'Every 25 h', do: 'Review per-cylinder EGT trends' },
    ],
  },

  ABNORMAL_VIBRATION: {
    summary: 'The engine is shaking more than it should.',
    now: [
      'Reduce RPM to find a smoother range',
      'Avoid running in the rough band',
      'Land soon if it gets worse',
    ],
    inspect: [
      'Inspect prop blades for nicks and track',
      'Balance the propeller dynamically',
      'Torque-check prop bolts and engine mounts',
      'Check mount rubbers for cracks and sag',
    ],
    prevent: [
      { every: 'Before each flight', do: 'Check the prop for nicks and damage' },
      { every: 'Every 100 h', do: 'Balance the prop, torque-check mounts' },
      { every: 'Every 200 h', do: 'Replace mount rubbers at calendar life' },
    ],
  },

  INJECTOR_ABNORMALITY: {
    summary: 'Fuel is not being metered correctly.',
    now: [
      'Compare fuel flow with the expected figure',
      'Switch tanks or pumps to rule out supply',
      'Plan an early landing — endurance is cut',
    ],
    inspect: [
      'Flow-test and clean the injectors',
      'Check rail pressure against spec',
      'Verify injection timing and ECU calibration',
      'Replace fuel filters, drain the sumps',
    ],
    prevent: [
      { every: 'Before each flight', do: 'Drain fuel sumps, check for water' },
      { every: 'Every 50 h', do: 'Replace fuel filters' },
      { every: 'Every 200 h', do: 'Flow-test the injectors as a set' },
    ],
  },

  COMBUSTION_INSTABILITY: {
    summary: 'The burn is unsteady — EGT and RPM keep swinging.',
    now: ['Enrich the mixture slightly', 'Reduce power and see if it settles'],
    inspect: [
      'Check the induction system for leaks',
      'Verify ignition timing and ECU inputs',
      'Sample the fuel for water',
      'Read the plugs for lean-running signs',
    ],
    prevent: [
      { every: 'Before each flight', do: 'Sample fuel from each tank sump' },
      { every: 'Every 100 h', do: 'Check ignition timing and intake clamps' },
      { every: 'Every 25 h', do: 'Watch the EGT spread between cylinders' },
    ],
  },

  ELECTRICAL_FAULT: {
    summary: 'The alternator is not keeping the battery charged.',
    now: [
      'Shed non-essential electrical load',
      'Land before the battery reserve runs down',
      'Expect less power available for the payload',
    ],
    inspect: [
      'Check alternator belt tension and wear',
      'Test the regulator and diodes',
      'Load-test the battery',
      'Check grounds and terminals for corrosion',
    ],
    prevent: [
      { every: 'Every 50 h', do: 'Inspect the alternator belt' },
      { every: 'Every 6 months', do: 'Battery capacity test' },
      { every: 'Before each flight', do: 'Record bus voltage and charge current' },
    ],
  },

  SENSOR_DRIFT_FAILURE: {
    summary: 'A sensor is drifting or dropping out — the engine may be fine.',
    now: ['Cross-check it against related sensors', 'Fly on the remaining indications'],
    inspect: [
      'Check the connector, wiring and shielding',
      'Compare with a calibrated reference',
      'Recalibrate or replace the sensor',
      'Inspect the harness for chafing',
    ],
    prevent: [
      { every: 'Every 100 h', do: 'Calibrate the engine sensors' },
      { every: 'Every 50 h', do: 'Inspect harness routing and connectors' },
      { every: 'Every 6 months', do: 'Review the sensor replacement log' },
    ],
  },

  UNKNOWN_ANOMALY: {
    summary: 'Unusual pattern spotted before any rule matched — often an early warning.',
    now: ['Note the flagged sensors and watch them', 'Keep flying, but monitor closely'],
    inspect: [
      'Review the trend charts around the alert',
      'Check the flagged sensors and their wiring',
      'Treat repeats at the same power setting as real',
    ],
    prevent: [
      { every: 'Every 50 h', do: 'Investigate repeats before they become faults' },
      { every: 'Every 200 h', do: 'Retrain the detector on recent healthy data' },
    ],
  },
}

export const GENERIC = {
  summary: 'No advisory has been written for this fault yet.',
  now: ['Watch the flagged sensors', 'Reduce power if readings keep worsening'],
  inspect: ['Inspect the systems tied to the flagged sensors'],
  prevent: [{ every: 'Every 100 h', do: 'Write an advisory for this fault type' }],
}

export function adviceFor(faultType) {
  return ADVICE[ALIASES[faultType] ?? faultType] ?? GENERIC
}
