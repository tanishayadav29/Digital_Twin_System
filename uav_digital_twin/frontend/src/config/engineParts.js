// Parts of the engine drawn on the Engine simulation tab.
//
// Each part's health is worked out from:
//   sensors - the readings that say how this part is doing (config/sensors.js)
//   faults  - fault types that damage it (fault_type strings from the detector)
//
// The drawing lives in tabs/EngineSimulation.jsx; `id` ties the two together.
// `short` is the name shown on the schematic when the full label is too long.
// Fault names include v1's (LOW_OIL_PRESSURE, HIGH_VIBRATION, FUEL_ANOMALY) so the
// tab works whichever detector the backend runs.
export const ENGINE_PARTS = [
  {
    id: 'propeller',
    label: 'Propeller',
    blurb: 'Driven by the crankshaft through the reduction drive. An out-of-balance blade shows up as vibration.',
    sensors: ['vibration', 'rpm'],
    faults: ['ABNORMAL_VIBRATION', 'HIGH_VIBRATION'],
  },
  {
    id: 'gearbox',
    label: 'Reduction drive',
    blurb: 'Gears the engine down to propeller speed. Wear shows as vibration at a steady RPM.',
    sensors: ['vibration', 'rpm'],
    faults: ['ABNORMAL_VIBRATION', 'HIGH_VIBRATION'],
  },
  {
    id: 'mounts',
    label: 'Engine mounts',
    blurb: 'Hold the engine to the airframe and damp its shaking.',
    sensors: ['vibration'],
    faults: ['ABNORMAL_VIBRATION', 'HIGH_VIBRATION', 'MISFIRE'],
  },
  {
    id: 'crankcase',
    short: 'Crankshaft',
    label: 'Crankshaft & bearings',
    blurb: 'Turns piston strokes into shaft rotation. Needs oil pressure; complains through vibration.',
    sensors: ['vibration', 'oil_pressure'],
    faults: ['LUBRICATION_ISSUE', 'LOW_OIL_PRESSURE', 'ABNORMAL_VIBRATION', 'MISFIRE'],
  },
  {
    id: 'cylinders',
    short: 'Cylinders',
    label: 'Cylinders & heads',
    blurb: 'Where combustion happens. Cylinder head temperature is the first sign of overheating.',
    sensors: ['cht'],
    faults: ['OVERHEATING', 'MISFIRE', 'COMBUSTION_INSTABILITY'],
  },
  {
    id: 'combustion',
    short: 'Ignition',
    label: 'Ignition & combustion',
    blurb: 'Spark plugs and the burn itself. A misfire drops RPM and exhaust temperature while vibration climbs.',
    sensors: ['egt', 'rpm', 'vibration'],
    faults: ['MISFIRE', 'COMBUSTION_INSTABILITY'],
  },
  {
    id: 'exhaust',
    label: 'Exhaust',
    blurb: 'Carries burnt gas away. Exhaust gas temperature reports how the mixture is burning.',
    sensors: ['egt'],
    faults: ['OVERHEATING', 'COMBUSTION_INSTABILITY'],
  },
  {
    id: 'cooling',
    short: 'Cooling air',
    label: 'Cooling airflow',
    blurb: 'Air through the cowling carries heat off the cylinders and oil cooler.',
    sensors: ['cht', 'oil_temperature'],
    faults: ['OVERHEATING'],
  },
  {
    id: 'fuel_tank',
    label: 'Fuel tank',
    blurb: 'Feeds the pump. An abnormal flow rate points at the fuel system.',
    sensors: ['fuel_flow'],
    faults: ['INJECTOR_ABNORMALITY', 'FUEL_ANOMALY'],
  },
  {
    id: 'fuel_pump',
    label: 'Fuel pump',
    blurb: 'Holds fuel pressure for the injectors.',
    sensors: ['fuel_flow'],
    faults: ['INJECTOR_ABNORMALITY', 'FUEL_ANOMALY'],
  },
  {
    id: 'injectors',
    short: 'Injectors',
    label: 'Injectors & rail',
    blurb: 'Meter fuel into each cylinder at the right moment. A leaking injector raises flow and shifts timing.',
    sensors: ['fuel_flow', 'injection_timing'],
    faults: ['INJECTOR_ABNORMALITY', 'FUEL_ANOMALY'],
  },
  {
    id: 'oil_sump',
    short: 'Oil sump',
    label: 'Oil sump',
    blurb: 'Holds the oil the pump picks up. Low level shows as falling pressure and rising temperature.',
    sensors: ['oil_pressure', 'oil_temperature'],
    faults: ['LUBRICATION_ISSUE', 'LOW_OIL_PRESSURE'],
  },
  {
    id: 'oil_pump',
    label: 'Oil pump',
    blurb: 'Pushes oil around the engine. Oil pressure is its direct read-out.',
    sensors: ['oil_pressure'],
    faults: ['LUBRICATION_ISSUE', 'LOW_OIL_PRESSURE'],
  },
  {
    id: 'oil_cooler',
    label: 'Oil cooler',
    blurb: 'Sheds heat from the oil into the airflow.',
    sensors: ['oil_temperature'],
    faults: ['LUBRICATION_ISSUE', 'OVERHEATING'],
  },
  {
    id: 'alternator',
    label: 'Alternator',
    blurb: 'Driven off the crankshaft; charges the battery and runs the avionics.',
    sensors: ['alternator_current'],
    faults: ['ELECTRICAL_FAULT'],
  },
  {
    id: 'battery',
    label: 'Battery',
    blurb: 'Buffers the electrical system. Voltage sags when the alternator stops keeping up.',
    sensors: ['battery_voltage'],
    faults: ['ELECTRICAL_FAULT'],
  },
]

export const PART_BY_ID = Object.fromEntries(ENGINE_PARTS.map((p) => [p.id, p]))
