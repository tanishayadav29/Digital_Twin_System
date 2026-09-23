// Building blocks for the procedural engine.
//
// <Part> is the 3D twin of the <Part> group in the 2D schematic: it owns one
// id from config/engineParts.js, handles selection and hover, and hands its
// meshes a material tinted by that part's health. <Shape> and <Pipe> are the
// geometry helpers the model is drawn with.
import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Edges } from '@react-three/drei'
import * as THREE from 'three'
import { PART_BY_ID } from '../../config/engineParts.js'
import { STATUS_BASE_INTENSITY, makeMaterial, pulseIntensity } from './materials.js'

const PartContext = createContext(null)

export function Part({ id, state, ghost = false, children }) {
  const { health, selected, hovered, onSelect, onHover, xray } = state
  const info = health[id] ?? { status: 'nodata', health: null }
  const isSelected = selected === id
  const isHovered = hovered === id
  const isGhost = ghost && xray

  // One material per finish per part, rebuilt only when the part's state changes.
  const ctx = useMemo(() => {
    const made = new Map()
    return {
      selected: isSelected,
      status: info.status,
      // `solid` opts a shape out of the cutaway: the castings go translucent,
      // but the crank, rods, pistons and gears inside them stay solid, which is
      // the whole point of looking through the case.
      get(finish, solid) {
        const key = solid ? `${finish}:solid` : finish
        if (!made.has(key)) {
          made.set(
            key,
            makeMaterial({
              finish,
              status: info.status,
              selected: isSelected,
              hovered: isHovered,
              ghost: isGhost && !solid,
            }),
          )
        }
        return made.get(key)
      },
      made,
    }
  }, [info.status, isSelected, isHovered, isGhost])

  useEffect(() => () => ctx.made.forEach((m) => m.dispose()), [ctx])

  const baseIntensity = useRef(0)
  baseIntensity.current = STATUS_BASE_INTENSITY(info.status, isSelected, isHovered)

  useFrame(({ clock }) => {
    if (info.status !== 'critical') return
    const next = pulseIntensity(baseIntensity.current, clock.elapsedTime)
    ctx.made.forEach((m) => {
      m.emissiveIntensity = next
    })
  })

  const part = PART_BY_ID[id]

  return (
    <PartContext.Provider value={ctx}>
      <group
        name={id}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(id)
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHover(id)
        }}
        onPointerOut={(event) => {
          event.stopPropagation()
          onHover(null)
        }}
        userData={{ partId: id, label: part?.label }}
      >
        {children}
      </group>
    </PartContext.Provider>
  )
}

function geometryFor(geo, args) {
  switch (geo) {
    case 'cylinder':
      return <cylinderGeometry args={args} />
    case 'sphere':
      return <sphereGeometry args={args} />
    case 'cone':
      return <coneGeometry args={args} />
    case 'torus':
      return <torusGeometry args={args} />
    case 'capsule':
      return <capsuleGeometry args={args} />
    case 'ring':
      return <ringGeometry args={args} />
    default:
      return <boxGeometry args={args} />
  }
}

export function Shape({ finish = 'case', geo = 'box', args, outline = true, solid = false, ...props }) {
  const ctx = useContext(PartContext)
  const material = ctx.get(finish, solid)

  return (
    <mesh material={material} castShadow receiveShadow {...props}>
      {geometryFor(geo, args)}
      {outline && ctx.selected && <Edges threshold={24} color="#f4f7fc" scale={1.015} />}
    </mesh>
  )
}

// A run of pipe or hose through a list of [x, y, z] points. Used for the
// exhaust headers, coolant hoses, oil lines and the fuel rail.
export function Pipe({ points, radius = 0.075, finish = 'steel', segments, outline = false, solid = true, ...props }) {
  const ctx = useContext(PartContext)
  const material = ctx.get(finish, solid)
  const key = JSON.stringify(points)

  const curve = useMemo(
    () => new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )

  return (
    <mesh material={material} castShadow {...props}>
      <tubeGeometry args={[curve, segments ?? Math.max(24, points.length * 10), radius, 10, false]} />
      {outline && ctx.selected && <Edges threshold={30} color="#f4f7fc" />}
    </mesh>
  )
}

// Shorthand: a cylinder lying along X or Z instead of three.js's default Y.
export const AXIS_X = [0, 0, Math.PI / 2]
export const AXIS_Z = [Math.PI / 2, 0, 0]
