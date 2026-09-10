// Parameter pairs plotted on the Engine trends tab. x/y are sensor keys from
// sensors.js; the hint tells the viewer where a fault shows up.
export const RELATIONSHIPS = [
  {
    id: 'cht-rpm',
    x: 'rpm',
    y: 'cht',
    title: 'CHT vs RPM',
    description: 'Thermal behaviour as engine speed changes',
    hint: 'Overheating lifts CHT above the envelope without a matching rise in RPM.',
  },
  {
    id: 'egt-rpm',
    x: 'rpm',
    y: 'egt',
    title: 'EGT vs RPM',
    description: 'Combustion and performance behaviour',
    hint: 'Misfire drags EGT and RPM down together (lower left); overheating pushes EGT up.',
  },
  {
    id: 'vib-rpm',
    x: 'rpm',
    y: 'vibration',
    title: 'Vibration vs RPM',
    description: 'Abnormal vibration and misfire signature',
    hint: 'Misfire shows as high vibration at reduced RPM (upper left).',
  },
  {
    id: 'oilp-rpm',
    x: 'rpm',
    y: 'oil_pressure',
    title: 'Oil pressure vs RPM',
    description: 'Lubrication health across engine speed',
    hint: 'Low oil pressure drops points below the envelope while RPM stays normal.',
  },
  {
    id: 'cht-egt',
    x: 'egt',
    y: 'cht',
    title: 'CHT vs EGT',
    description: 'How the two thermal indicators move together',
    hint: 'Overheating moves both up at once (upper right) and pushes r strongly positive.',
  },
]
