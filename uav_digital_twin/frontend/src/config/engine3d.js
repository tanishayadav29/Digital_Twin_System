// Dimensional reference for the 3D engine on the Engine simulation tab.
//
// The model is built procedurally (no imported mesh) from the published figures
// for the Rotax 912 iS Sport - the fuel-injected 912, chosen because this twin
// carries injection_timing and fuel_flow sensors, which the carburetted 912 ULS
// and the turbocharged 914 do not have.
//
//   Layout          horizontally opposed four cylinder, four stroke
//   Bore x stroke   84.0 mm x 61.0 mm  ->  1352 cm3
//   Cooling         liquid-cooled heads, ram-air cooled cylinder barrels
//   Lubrication     dry sump, separate oil tank, camshaft-driven trochoid pump
//   Ignition        dual electronic, two spark plugs per cylinder
//   Gearbox         integrated reduction drive, 2.43:1 (2.27:1 optional)
//   Envelope        561 mm long x 576 mm wide x 397 mm high, 63.6 kg dry
//   Rated           75 kW (100 hp) at 5800 rpm
//
// Sources are listed in ENGINE_3D_SOURCES below. Two numbers are NOT published
// by BRP-Rotax and are marked `estimated` where they are used: the connecting
// rod length and the individual casting wall thicknesses. Everything else on
// screen is drawn from the figures above.
//
// Units: 1 scene unit = 100 mm, so the whole engine is ~5.6 units long. Axes:
//   +X  forward, toward the propeller
//   +Y  up
//   +Z  the right-hand cylinder bank (-Z is the left bank)

export const ENGINE_3D_SOURCES = [
  {
    label: 'Rotax 912 iS Sport / iSc Sport specification sheet',
    href: 'https://www.flyrotax.com/products/912-is-sport-isc-sport',
    gives: 'variant, rated power, gearbox ratio, dry weight',
  },
  {
    label: 'Rotax 912 — Wikipedia',
    href: 'https://en.wikipedia.org/wiki/Rotax_912',
    gives: 'bore, stroke, displacement, cooling split, dry sump, dual ignition, envelope',
  },
  {
    label: 'Rotax Owner — 912 iS Sport specifications',
    href: 'https://www.rotax-owner.com/en/support-topmenu/technical-information/rotax-engine-specifications/22-912is-sport-specifications/file',
    gives: 'bore 84 mm, 1352 cm3, 2.43:1 reduction, 63.6 kg with gearbox',
  },
  {
    label: 'EASA TCDS E.121 — Rotax 912 series',
    href: 'https://www.easa.europa.eu/en/downloads/7633/en',
    gives: 'certified variant list and operating limits',
  },
]

export const SPEC = {
  variant: '912 iS Sport',
  layout: 'Horizontally opposed four, four stroke',
  boreMm: 84,
  strokeMm: 61,
  displacementCc: 1352,
  gearboxRatio: 2.43,
  ratedKw: 75,
  ratedRpm: 5800,
  dryWeightKg: 63.6,
  lengthMm: 561,
  widthMm: 576,
  heightMm: 397,
  cooling: 'Liquid-cooled heads, air-cooled barrels',
  lubrication: 'Dry sump, separate oil tank',
  ignition: 'Dual electronic, 2 plugs per cylinder',
}

const MM = 0.01
const mm = (value) => value * MM

// ---------------------------------------------------------------- core sizes
export const BORE_R = mm(SPEC.boreMm / 2) // 0.42
export const CRANK_R = mm(SPEC.strokeMm / 2) // 0.305 - half the stroke is the crank throw
export const ROD_LEN = mm(110) // estimated; BRP does not publish rod length

// Crankcase: the magnesium case halves that carry the crank.
export const CASE = { halfX: 1.52, halfY: 0.62, halfZ: 0.7 }

// Cylinder stack, measured outward from the crank axis along Z.
export const BARREL = { spigot: 0.46, finStart: 0.8, finEnd: 1.52, top: 1.58, r: 0.52 }
export const HEAD = { inner: 1.58, outer: 2.3, halfY: 0.46, halfX: 0.44 }
export const PISTON_H = 0.3

// Reduction gearbox and propeller, forward of the case.
export const GEARBOX = { x0: 1.52, x1: 2.34, halfY: 0.62, halfZ: 0.58 }
// The propeller is deliberately NOT to scale. A 912's prop is about 1700 mm
// across - three times the length of the engine - which would leave the engine
// a speck in the middle of the frame. It is drawn as a stub at roughly a third
// of true diameter so the engine stays the subject; everything else on screen
// is at the published size.
export const PROP = { hubX: 2.5, hubR: 0.3, blade: 2.0, pitchDeg: 16, toScale: false }

// Ground plane for the contact shadow and grid, clear of the blade tips.
export const GROUND_Y = -2.6

// Main bearing journals along the crank axis.
export const JOURNALS = [-1.3, 0, 1.3]

// The four cylinders. `s` picks the bank, `phase` the crank angle offset:
// a boxer's opposed pair reaches TDC together, and the front pair runs 180
// degrees from the rear pair, which is what makes a flat four feel smooth.
export const CYLINDERS = [
  { n: 1, s: 1, x: 0.72, phase: 0 },
  { n: 2, s: -1, x: 0.54, phase: 0 },
  { n: 3, s: 1, x: -0.54, phase: Math.PI },
  { n: 4, s: -1, x: -0.72, phase: Math.PI },
]

// How far the piston crown sits from the crank axis at crank angle `theta`.
// Standard slider-crank: r*cos + sqrt(rod^2 - (r*sin)^2), so the crown swings
// through exactly one stroke (0.61 units) per revolution.
export function pistonReach(theta, phase) {
  const a = theta + phase
  const sin = CRANK_R * Math.sin(a)
  return CRANK_R * Math.cos(a) + Math.sqrt(ROD_LEN * ROD_LEN - sin * sin)
}

// Crank pin centre for one cylinder, in the plane the rod swings through.
export function pinPosition(theta, phase, s) {
  const a = theta + phase
  return { z: s * CRANK_R * Math.cos(a), y: s * CRANK_R * Math.sin(a) }
}

// Crank revolutions are far too fast to animate literally - 3000 rpm is 50 per
// second. This scales it to something the eye can follow while staying
// proportional to the real reading.
export const VISUAL_SPIN = 0.02 // 3000 rpm -> 1 turn per second on screen

// Where each part of engineParts.js sits, for the camera to frame on select.
export const PART_FOCUS = {
  propeller: [2.5, 0, 0],
  gearbox: [1.9, 0, 0],
  crankcase: [0, -0.1, 0],
  cylinders: [0.6, 0.1, 1.9],
  combustion: [0.6, 0.35, 2.2],
  injectors: [0.6, 0.85, 1.7],
  fuel_pump: [-1.3, 0.95, 0],
  fuel_tank: [-3.6, 0.1, 0],
  exhaust: [-1.2, -1.25, 0],
  cooling: [2.0, -0.9, 0],
  oil_sump: [-2.35, 0.55, 0],
  oil_pump: [-1.75, -0.4, 0],
  oil_cooler: [1.1, -1.4, 0],
  alternator: [-1.8, 0, 0],
  battery: [-3.6, -0.95, 0],
  mounts: [-1.15, -0.7, 0.9],
}
