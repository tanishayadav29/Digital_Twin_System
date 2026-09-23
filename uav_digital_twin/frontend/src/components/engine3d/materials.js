// Surfaces for the 3D engine.
//
// A part's material is its real material (cast aluminium, steel, rubber hose)
// tinted by the health lib/health.js worked out for it, so the colour carries
// the same meaning as the 2D schematic: green healthy, amber degraded, red at
// risk, grey no reading. Status colours are the tokens from styles.css.
import * as THREE from 'three'

export const FINISH = {
  case: { color: '#94a1b4', metalness: 0.55, roughness: 0.48 }, // cast magnesium/alu
  head: { color: '#aab5c6', metalness: 0.5, roughness: 0.38 },
  steel: { color: '#7a8499', metalness: 0.88, roughness: 0.26 },
  dark: { color: '#3c4658', metalness: 0.45, roughness: 0.62 },
  rubber: { color: '#232b3b', metalness: 0.04, roughness: 0.92 },
  copper: { color: '#b3794f', metalness: 0.82, roughness: 0.34 },
  alloy: { color: '#c3ccd9', metalness: 0.68, roughness: 0.3 },
}

const STATUS = {
  normal: { tint: null, amount: 0, emissive: '#34d67b', intensity: 0.05 },
  warning: { tint: '#fbbf24', amount: 0.4, emissive: '#fbbf24', intensity: 0.32 },
  critical: { tint: '#ff5c62', amount: 0.58, emissive: '#ff5c62', intensity: 0.5 },
  nodata: { tint: '#4b5570', amount: 0.72, emissive: '#000000', intensity: 0 },
}

// How much a selected or hovered part lifts out of the scene.
const SELECTED_BOOST = 0.34
const HOVER_BOOST = 0.16

export function makeMaterial({ finish = 'case', status = 'nodata', selected, hovered, ghost }) {
  const base = FINISH[finish] ?? FINISH.case
  const tone = STATUS[status] ?? STATUS.nodata

  const color = new THREE.Color(base.color)
  if (tone.tint) color.lerp(new THREE.Color(tone.tint), tone.amount)

  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: ghost ? base.metalness * 0.3 : base.metalness,
    roughness: ghost ? 0.7 : base.roughness,
    emissive: new THREE.Color(tone.emissive),
    emissiveIntensity: tone.intensity + (selected ? SELECTED_BOOST : hovered ? HOVER_BOOST : 0),
  })

  // Cutaway view: the castings go translucent so the crank, rods and pistons
  // inside them stay clickable instead of being buried.
  if (ghost) {
    material.transparent = true
    material.opacity = selected ? 0.34 : 0.17
    material.depthWrite = false
    material.side = THREE.DoubleSide
  }

  return material
}

// Critical parts breathe, so a red part is still obvious on a small screen or
// to anyone who reads the red and green as the same colour.
export function pulseIntensity(base, elapsed) {
  return base + 0.22 * (0.5 + 0.5 * Math.sin(elapsed * 4.2))
}

export const STATUS_BASE_INTENSITY = (status, selected, hovered) =>
  (STATUS[status] ?? STATUS.nodata).intensity + (selected ? SELECTED_BOOST : hovered ? HOVER_BOOST : 0)
