// The engine itself, built from the figures in config/engine3d.js.
//
// Every group here is one id from config/engineParts.js, so clicking a casting
// on screen selects the same part the 2D schematic would. Nothing is imported
// from a modelling package - the shapes are three.js primitives placed at the
// published dimensions of the Rotax 912 iS Sport.
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  BARREL,
  BORE_R,
  CASE,
  CRANK_R,
  CYLINDERS,
  GEARBOX,
  HEAD,
  JOURNALS,
  PISTON_H,
  PROP,
  ROD_LEN,
  pistonReach,
} from '../../config/engine3d.js'
import { AXIS_X, AXIS_Z, Part, Pipe, Shape } from './primitives.jsx'

// Reused so the per-frame maths allocates nothing.
const tmpStart = new THREE.Vector3()
const tmpEnd = new THREE.Vector3()
const tmpDir = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

const FIN_Z = Array.from({ length: 9 }, (_, i) => BARREL.finStart + i * ((BARREL.finEnd - BARREL.finStart) / 8))

/* ------------------------------------------------------------------ moving */

// Pistons slide along their bank; the pair at each station reaches top dead
// centre together, which is what makes this a boxer rather than a 180 degree V.
function Pistons({ spin }) {
  const refs = useRef([])

  useFrame(() => {
    const theta = spin.current.theta
    CYLINDERS.forEach((cyl, i) => {
      const mesh = refs.current[i]
      if (mesh) mesh.position.z = cyl.s * (pistonReach(theta, cyl.phase) - PISTON_H / 2)
    })
  })

  return CYLINDERS.map((cyl, i) => (
    <group key={cyl.n} position={[cyl.x, 0, 0]}>
      <Shape
        ref={(el) => {
          refs.current[i] = el
        }}
        solid
        finish="alloy"
        geo="cylinder"
        args={[BORE_R - 0.015, BORE_R - 0.015, PISTON_H, 28]}
        rotation={AXIS_Z}
      />
    </group>
  ))
}

// Connecting rods run from their crank pin to the piston pin. Both ends are
// solved every frame, so the rod swings exactly as the slider-crank says it should.
function ConnectingRods({ spin }) {
  const refs = useRef([])

  useFrame(() => {
    const theta = spin.current.theta
    CYLINDERS.forEach((cyl, i) => {
      const rod = refs.current[i]
      if (!rod) return
      const a = theta + cyl.phase
      const reach = pistonReach(theta, cyl.phase)

      tmpStart.set(cyl.x, cyl.s * CRANK_R * Math.sin(a), cyl.s * CRANK_R * Math.cos(a))
      tmpEnd.set(cyl.x, 0, cyl.s * reach)
      tmpDir.subVectors(tmpEnd, tmpStart).normalize()

      rod.position.copy(tmpStart).add(tmpEnd).multiplyScalar(0.5)
      rod.quaternion.setFromUnitVectors(UP, tmpDir)
    })
  })

  return CYLINDERS.map((cyl, i) => (
    <Shape
      key={cyl.n}
      ref={(el) => {
        refs.current[i] = el
      }}
      solid
      finish="steel"
      geo="box"
      args={[0.13, ROD_LEN, 0.09]}
      outline={false}
    />
  ))
}

// Journals, webs and pins as one rigid group. Rotating it by -theta puts every
// pin where pinPosition() says it should be.
function Crankshaft({ spin }) {
  const shaft = useRef()

  useFrame(() => {
    if (shaft.current) shaft.current.rotation.x = -spin.current.theta
  })

  return (
    <group ref={shaft}>
      {JOURNALS.map((x) => (
        <Shape key={x} solid finish="steel" geo="cylinder" args={[0.22, 0.22, 0.2, 24]} rotation={AXIS_X} position={[x, 0, 0]} />
      ))}
      <Shape solid finish="steel" geo="cylinder" args={[0.11, 0.11, CASE.halfX * 2 + 0.7, 18]} rotation={AXIS_X} />

      {CYLINDERS.map((cyl) => {
        const y0 = cyl.s * CRANK_R * Math.sin(cyl.phase)
        const z0 = cyl.s * CRANK_R * Math.cos(cyl.phase)
        return (
          <group key={cyl.n} position={[cyl.x, 0, 0]}>
            {/* counterweight opposite the pin */}
            <Shape
              solid
              finish="steel"
              geo="cylinder"
              args={[0.34, 0.34, 0.12, 20]}
              rotation={AXIS_X}
              position={[0, -y0 * 0.75, -z0 * 0.75]}
            />
            {/* the crank pin the rod hangs off */}
            <Shape solid finish="steel" geo="cylinder" args={[0.15, 0.15, 0.2, 18]} rotation={AXIS_X} position={[0, y0, z0]} />
          </group>
        )
      })}
    </group>
  )
}

function Propeller({ spin }) {
  const hub = useRef()

  useFrame(() => {
    if (hub.current) hub.current.rotation.x = -spin.current.prop
  })

  const pitch = (PROP.pitchDeg * Math.PI) / 180

  return (
    <group ref={hub} position={[PROP.hubX, 0, 0]}>
      <Shape finish="alloy" geo="cylinder" args={[PROP.hubR, PROP.hubR, 0.3, 26]} rotation={AXIS_X} />
      <Shape finish="dark" geo="cone" args={[PROP.hubR, 0.5, 26]} rotation={[0, 0, -Math.PI / 2]} position={[0.38, 0, 0]} />
      {[0, 120, 240].map((deg) => (
        <group key={deg} rotation={[(deg * Math.PI) / 180, 0, 0]}>
          {/* Root and outer panel, twisted about the blade's own span axis.
              The root starts at the hub face and the outer panel picks up
              exactly where it ends, so there is no gap at the joint. */}
          <Shape
            finish="dark"
            geo="box"
            args={[0.12, 0.85, 0.46]}
            position={[0, PROP.hubR + 0.425, 0]}
            rotation={[0, pitch, 0]}
            outline={false}
          />
          <Shape
            finish="dark"
            geo="box"
            args={[0.08, PROP.blade - 0.85, 0.34]}
            position={[0, PROP.hubR + 0.85 + (PROP.blade - 0.85) / 2, 0]}
            rotation={[0, pitch * 0.55, 0]}
            outline={false}
          />
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ statics */

function CylinderAssembly({ cyl }) {
  const { s, x } = cyl
  const mid = (BARREL.spigot + BARREL.top) / 2

  return (
    <group position={[x, 0, 0]}>
      {/* barrel, with the ram-air cooling fins the 912 runs on its cylinders */}
      <Shape
        finish="case"
        geo="cylinder"
        args={[BARREL.r, BARREL.r, BARREL.top - BARREL.spigot, 28]}
        rotation={AXIS_Z}
        position={[0, 0, s * mid]}
      />
      {FIN_Z.map((z) => (
        <Shape
          key={z}
          finish="case"
          geo="cylinder"
          args={[BARREL.r + 0.11, BARREL.r + 0.11, 0.035, 28]}
          rotation={AXIS_Z}
          position={[0, 0, s * z]}
          outline={false}
        />
      ))}

      {/* liquid-cooled head and rocker cover */}
      <Shape
        finish="head"
        geo="box"
        args={[HEAD.halfX * 2, HEAD.halfY * 2, HEAD.outer - HEAD.inner]}
        position={[0, 0, s * (HEAD.inner + HEAD.outer) / 2]}
      />
      <Shape
        finish="alloy"
        geo="box"
        args={[HEAD.halfX * 1.7, 0.26, HEAD.outer - HEAD.inner - 0.16]}
        position={[0, HEAD.halfY + 0.12, s * (HEAD.inner + HEAD.outer) / 2]}
      />
      <Shape
        finish="dark"
        geo="cylinder"
        args={[0.3, 0.3, 0.1, 24]}
        rotation={AXIS_Z}
        position={[0, 0, s * (HEAD.outer + 0.05)]}
      />
    </group>
  )
}

export function EngineModel({ state, spin }) {
  const part = (id, ghost = false) => ({ id, state, ghost })

  return (
    <group>
      {/* ---------------------------------------------------- crankcase ---- */}
      <Part {...part('crankcase', true)}>
        <Shape finish="case" geo="box" args={[CASE.halfX * 2, CASE.halfY * 2, CASE.halfZ * 2]} />
        <Shape finish="case" geo="box" args={[CASE.halfX * 2 + 0.06, 0.1, CASE.halfZ * 2 + 0.06]} position={[0, 0, 0]} />
        {[-1.05, -0.35, 0.35, 1.05].map((x) => (
          <Shape key={x} finish="case" geo="box" args={[0.08, CASE.halfY * 2 + 0.06, CASE.halfZ * 2 + 0.06]} position={[x, 0, 0]} />
        ))}
        <Shape finish="case" geo="cylinder" args={[0.46, 0.46, 0.12, 24]} rotation={AXIS_X} position={[-CASE.halfX - 0.05, 0, 0]} />
        <Crankshaft spin={spin} />
        <ConnectingRods spin={spin} />
      </Part>

      {/* ---------------------------------------- cylinders and pistons ---- */}
      <Part {...part('cylinders', true)}>
        {CYLINDERS.map((cyl) => (
          <CylinderAssembly key={cyl.n} cyl={cyl} />
        ))}
        <Pistons spin={spin} />
      </Part>

      {/* -------------------------------- ignition: two plugs per cylinder -- */}
      <Part {...part('combustion')}>
        {CYLINDERS.map((cyl) =>
          [0.24, -0.24].map((y) => (
            <group key={`${cyl.n}${y}`} position={[cyl.x, y, 0]}>
              <Shape
                finish="steel"
                geo="cylinder"
                args={[0.07, 0.07, 0.26, 14]}
                rotation={AXIS_Z}
                position={[0, 0, cyl.s * (HEAD.outer + 0.14)]}
              />
              <Shape
                finish="dark"
                geo="cylinder"
                args={[0.1, 0.1, 0.16, 14]}
                rotation={AXIS_Z}
                position={[0, 0, cyl.s * (HEAD.outer + 0.33)]}
              />
              <Pipe
                finish="rubber"
                radius={0.045}
                points={[
                  [0, 0, cyl.s * (HEAD.outer + 0.4)],
                  [0, 0.45, cyl.s * (HEAD.outer * 0.75)],
                  [-cyl.x * 0.4, 0.8, cyl.s * 0.55],
                  [-cyl.x, 0.78, 0],
                ]}
              />
            </group>
          )),
        )}
        {/* dual ignition modules on top of the case */}
        <Shape finish="dark" geo="box" args={[0.44, 0.2, 0.34]} position={[-0.75, 0.82, 0]} />
        <Shape finish="dark" geo="box" args={[0.44, 0.2, 0.34]} position={[0.75, 0.82, 0]} />
      </Part>

      {/* --------------------------------- fuel injection rail + injectors -- */}
      <Part {...part('injectors')}>
        {[1, -1].map((s) => (
          <group key={s}>
            <Pipe
              finish="alloy"
              radius={0.06}
              points={[
                [-1.0, 1.0, s * 0.85],
                [0, 1.02, s * 0.9],
                [1.0, 1.0, s * 0.85],
              ]}
            />
            {CYLINDERS.filter((c) => c.s === s).map((cyl) => (
              <group key={cyl.n}>
                {/* intake runner into the head */}
                <Pipe
                  finish="alloy"
                  radius={0.11}
                  points={[
                    [cyl.x, 0.98, s * 0.9],
                    [cyl.x, 0.86, s * 1.35],
                    [cyl.x, 0.6, s * 1.75],
                    [cyl.x, 0.42, s * 1.95],
                  ]}
                />
                <Shape
                  finish="dark"
                  geo="cylinder"
                  args={[0.08, 0.08, 0.24, 14]}
                  position={[cyl.x, 0.88, s * 1.18]}
                  rotation={[0.9 * s, 0, 0]}
                />
              </group>
            ))}
          </group>
        ))}
        {/* throttle body / plenum feeding both banks */}
        <Shape finish="alloy" geo="box" args={[0.5, 0.3, 0.66]} position={[0, 1.12, 0]} />
      </Part>

      {/* ------------------------------------------------- fuel delivery ---- */}
      <Part {...part('fuel_pump')}>
        <Shape finish="dark" geo="cylinder" args={[0.17, 0.17, 0.4, 20]} rotation={AXIS_X} position={[-1.35, 0.9, -0.45]} />
        <Shape finish="steel" geo="box" args={[0.3, 0.14, 0.22]} position={[-1.35, 0.68, -0.45]} />
        <Pipe
          finish="rubber"
          radius={0.055}
          points={[
            [-1.15, 0.9, -0.45],
            [-0.7, 1.0, -0.4],
            [-0.4, 1.05, -0.2],
            [-0.2, 1.06, 0],
          ]}
        />
      </Part>

      <Part {...part('fuel_tank')}>
        <Shape finish="dark" geo="box" args={[1.25, 0.86, 1.85]} position={[-3.75, 0.35, 0]} />
        <Shape finish="alloy" geo="cylinder" args={[0.14, 0.14, 0.2, 18]} position={[-3.75, 0.88, 0.55]} />
        <Pipe
          finish="rubber"
          radius={0.055}
          points={[
            [-3.2, 0.2, -0.5],
            [-2.6, 0.4, -0.6],
            [-1.9, 0.75, -0.55],
            [-1.5, 0.9, -0.45],
          ]}
        />
      </Part>

      {/* ------------------------------------------------------- exhaust ---- */}
      <Part {...part('exhaust')}>
        {CYLINDERS.map((cyl) => (
          <Pipe
            key={cyl.n}
            finish="steel"
            radius={0.1}
            points={[
              [cyl.x, -0.42, cyl.s * 2.0],
              [cyl.x, -0.82, cyl.s * 1.7],
              [cyl.x * 0.8, -1.08, cyl.s * 1.05],
              [-0.5, -1.18, cyl.s * 0.4],
              [-1.25, -1.2, 0],
            ]}
          />
        ))}
        <Shape finish="steel" geo="cylinder" args={[0.3, 0.3, 1.0, 22]} rotation={AXIS_X} position={[-1.95, -1.2, 0]} />
        <Shape finish="steel" geo="cylinder" args={[0.12, 0.12, 0.6, 16]} rotation={AXIS_X} position={[-2.7, -1.2, 0]} />
      </Part>

      {/* ------- cooling: liquid-cooled heads, air-cooled barrels (912) ----- */}
      <Part {...part('cooling')}>
        <Shape finish="dark" geo="box" args={[0.14, 1.0, 1.5]} position={[2.05, -1.05, 0]} />
        {Array.from({ length: 11 }, (_, i) => -0.65 + i * 0.13).map((z) => (
          <Shape key={z} finish="steel" geo="box" args={[0.18, 0.92, 0.03]} position={[2.05, -1.05, z]} outline={false} />
        ))}
        {[1, -1].map((s) => (
          <Pipe
            key={s}
            finish="rubber"
            radius={0.09}
            points={[
              [2.0, -0.6, s * 0.3],
              [1.5, -0.1, s * 0.9],
              [0.9, 0.45, s * 1.5],
              [0.63, 0.5, s * 1.9],
            ]}
          />
        ))}
        {/* expansion tank and the pump at the back of the case */}
        <Shape finish="alloy" geo="cylinder" args={[0.2, 0.2, 0.5, 20]} rotation={AXIS_X} position={[-0.2, 1.05, 0.62]} />
        <Shape finish="case" geo="cylinder" args={[0.24, 0.24, 0.26, 20]} rotation={AXIS_X} position={[-1.68, 0.18, -0.38]} />
      </Part>

      {/* ------------------------------ oil: dry sump, separate oil tank ---- */}
      <Part {...part('oil_sump')}>
        <Shape finish="alloy" geo="cylinder" args={[0.4, 0.4, 1.0, 26]} rotation={AXIS_X} position={[-2.45, 0.6, 0]} />
        <Shape finish="dark" geo="cylinder" args={[0.13, 0.13, 0.12, 16]} position={[-2.45, 1.05, 0]} />
        <Pipe
          finish="rubber"
          radius={0.07}
          points={[
            [-2.45, 0.2, 0.3],
            [-2.2, -0.1, 0.35],
            [-1.9, -0.3, 0.3],
          ]}
        />
      </Part>

      <Part {...part('oil_pump')}>
        <Shape finish="case" geo="cylinder" args={[0.24, 0.24, 0.34, 22]} rotation={AXIS_X} position={[-1.76, -0.32, 0.28]} />
        <Shape finish="steel" geo="cylinder" args={[0.1, 0.1, 0.16, 14]} rotation={AXIS_X} position={[-1.55, -0.32, 0.28]} />
      </Part>

      <Part {...part('oil_cooler')}>
        <Shape finish="dark" geo="box" args={[1.1, 0.2, 1.2]} position={[1.0, -1.45, 0]} />
        {Array.from({ length: 9 }, (_, i) => -0.48 + i * 0.12).map((z) => (
          <Shape key={z} finish="steel" geo="box" args={[1.02, 0.25, 0.03]} position={[1.0, -1.45, z]} outline={false} />
        ))}
        <Pipe
          finish="rubber"
          radius={0.07}
          points={[
            [-1.6, -0.35, 0.45],
            [-0.6, -0.9, 0.6],
            [0.45, -1.35, 0.5],
          ]}
        />
      </Part>

      {/* ---------------------------------------------------- electrical ---- */}
      <Part {...part('alternator')}>
        <Shape finish="case" geo="cylinder" args={[0.5, 0.5, 0.34, 28]} rotation={AXIS_X} position={[-1.85, 0, 0]} />
        <Shape finish="copper" geo="cylinder" args={[0.34, 0.34, 0.4, 24]} rotation={AXIS_X} position={[-1.9, 0, 0]} />
        <Pipe
          finish="rubber"
          radius={0.05}
          points={[
            [-2.1, -0.2, -0.3],
            [-2.7, -0.6, -0.5],
            [-3.3, -0.85, -0.45],
          ]}
        />
      </Part>

      <Part {...part('battery')}>
        <Shape finish="dark" geo="box" args={[0.95, 0.58, 0.85]} position={[-3.75, -0.95, 0]} />
        <Shape finish="copper" geo="cylinder" args={[0.07, 0.07, 0.12, 14]} position={[-3.95, -0.6, 0.25]} />
        <Shape finish="steel" geo="cylinder" args={[0.07, 0.07, 0.12, 14]} position={[-3.55, -0.6, 0.25]} />
      </Part>

      {/* ------------------------------------------------------- mounts ----- */}
      <Part {...part('mounts')}>
        {[1, -1].map((sx) =>
          [1, -1].map((sz) => (
            <group key={`${sx}${sz}`}>
              <Shape finish="case" geo="box" args={[0.34, 0.2, 0.42]} position={[sx * 1.15, -0.52, sz * 0.78]} />
              <Shape
                finish="rubber"
                geo="cylinder"
                args={[0.13, 0.13, 0.22, 16]}
                position={[sx * 1.15, -0.72, sz * 0.9]}
              />
            </group>
          )),
        )}
      </Part>

      {/* --------------------------------- reduction drive and propeller ---- */}
      <Part {...part('gearbox', true)}>
        <Shape
          finish="case"
          geo="box"
          args={[GEARBOX.x1 - GEARBOX.x0, GEARBOX.halfY * 2, GEARBOX.halfZ * 2]}
          position={[(GEARBOX.x0 + GEARBOX.x1) / 2, 0, 0]}
        />
        <Shape finish="case" geo="cylinder" args={[0.46, 0.46, 0.18, 26]} rotation={AXIS_X} position={[GEARBOX.x1 + 0.05, 0, 0]} />
        {/* the 2.43:1 gear pair, visible in cutaway */}
        <Shape solid finish="steel" geo="cylinder" args={[0.44, 0.44, 0.16, 30]} rotation={AXIS_X} position={[1.85, 0.22, 0]} />
        <Shape solid finish="steel" geo="cylinder" args={[0.18, 0.18, 0.16, 22]} rotation={AXIS_X} position={[1.85, -0.3, 0]} />
        <Shape solid finish="steel" geo="cylinder" args={[0.13, 0.13, 0.9, 18]} rotation={AXIS_X} position={[2.2, 0.22, 0]} />
      </Part>

      <Part {...part('propeller')}>
        <Propeller spin={spin} />
      </Part>
    </group>
  )
}
