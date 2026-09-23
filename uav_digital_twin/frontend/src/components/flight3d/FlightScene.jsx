// The replayed UAV, flying the reconstructed track through the block field.
//
// Position comes from lib/flightPath.js (distance along the route and
// altitude), attitude comes from the route's own geometry: heading from the
// tangent, bank from a coordinated turn at the current speed and curvature,
// pitch from climb rate against airspeed. So the aircraft leans into corners
// and noses up when the recording says it was climbing.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { ALT_MAX, PHASES, frameAt } from '../../lib/flightPath.js'
import { SITE_LENGTH, buildCity, buildRoute, turnAt } from './city.js'

const G = 9.81
const MAX_BANK = 0.6 // ~34 degrees
const MAX_PITCH = 0.26 // ~15 degrees
const LIVE_LAG_MS = 1200 // live mode flies this far behind the newest reading

// Where the camera sits relative to the aircraft when the view first opens:
// behind, above and off to one side, about 110 m out.
const CAMERA_OFFSET = new THREE.Vector3(62, 44, 80)

// The sun travels with the aircraft. The site is over 5 km long, so a shadow
// map fixed at the origin would cover a fraction of it; following the aircraft
// keeps a tight, sharp shadow camera wherever it happens to be.
const SUN_OFFSET = new THREE.Vector3(260, 420, 200)

const tmpVec = new THREE.Vector3()

/* ------------------------------------------------------------------ scenery */

function Ground() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]} receiveShadow>
        <planeGeometry args={[SITE_LENGTH * 2.6, SITE_LENGTH * 2.6]} />
        <meshStandardMaterial color="#0d1a2e" roughness={0.95} />
      </mesh>
      {/* 100 m grid squares, so height and distance stay readable */}
      <gridHelper args={[SITE_LENGTH * 2, (SITE_LENGTH * 2) / 100, '#1b3358', '#132741']} />
    </>
  )
}

// Keeps the key light (and so the shadow camera) centred on the aircraft.
function SunRig({ craftRef }) {
  const sun = useRef()

  useFrame(() => {
    if (!sun.current || !craftRef.current) return
    const here = craftRef.current.position
    sun.current.position.copy(here).add(SUN_OFFSET)
    sun.current.target.position.copy(here)
    // The target is not part of the scene graph, so its matrix is ours to update.
    sun.current.target.updateMatrixWorld()
  })

  return (
    <directionalLight
      ref={sun}
      intensity={2.2}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-420}
      shadow-camera-right={420}
      shadow-camera-top={420}
      shadow-camera-bottom={-420}
      shadow-camera-near={10}
      shadow-camera-far={1400}
    />
  )
}

// One instanced mesh for every block, so a field of them is a single draw call.
function City({ blocks }) {
  const bodies = useRef()
  const masts = useRef()
  const withMast = useMemo(() => blocks.filter((b) => b.mast > 0), [blocks])

  useEffect(() => {
    const matrix = new THREE.Matrix4()
    const colour = new THREE.Color()

    blocks.forEach((b, i) => {
      matrix.makeScale(b.width, b.height, b.depth)
      matrix.setPosition(b.x, b.height / 2, b.z)
      bodies.current.setMatrixAt(i, matrix)
      colour.setRGB(0.16 * b.shade, 0.22 * b.shade, 0.33 * b.shade)
      bodies.current.setColorAt(i, colour)
    })
    bodies.current.instanceMatrix.needsUpdate = true
    if (bodies.current.instanceColor) bodies.current.instanceColor.needsUpdate = true

    withMast.forEach((b, i) => {
      matrix.makeScale(1.4, b.mast, 1.4)
      matrix.setPosition(b.x, b.height + b.mast / 2, b.z)
      masts.current.setMatrixAt(i, matrix)
    })
    // The buffer is allocated with at least one slot; draw only the real ones,
    // otherwise an unused instance shows up as a stray cube at the origin.
    masts.current.count = withMast.length
    masts.current.instanceMatrix.needsUpdate = true
  }, [blocks, withMast])

  return (
    <>
      <instancedMesh ref={bodies} args={[undefined, undefined, blocks.length]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.86} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={masts} args={[undefined, undefined, Math.max(withMast.length, 1)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#35507a" roughness={0.7} />
      </instancedMesh>
    </>
  )
}

function RouteTrack({ route }) {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(route.getSpacedPoints(400))
    const material = new THREE.LineBasicMaterial({ color: '#3f6ea8', transparent: true, opacity: 0.55 })
    return new THREE.LineLoop(geometry, material)
  }, [route])

  useEffect(() => () => {
    line.geometry.dispose()
    line.material.dispose()
  }, [line])

  return <primitive object={line} position={[0, 0.6, 0]} />
}

/* ---------------------------------------------------------------- aircraft */

// A MALE UAV: long slender wing, slim fuselage, V-tail on a boom and a pusher
// propeller at the back. Built nose-along-+X so heading is a single yaw.
function Airframe() {
  return (
    <group>
      {/* fuselage - capsule lies along Y by default, so turn it onto X */}
      <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.85, 7.4, 6, 14]} />
        <meshStandardMaterial color="#c9d3e2" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[4.6, 0.1, 0]} castShadow>
        <sphereGeometry args={[0.95, 16, 12]} />
        <meshStandardMaterial color="#aab6c9" roughness={0.45} metalness={0.25} />
      </mesh>
      {/* wing */}
      <mesh position={[0.2, 0.55, 0]} castShadow>
        <boxGeometry args={[2.2, 0.28, 28]} />
        <meshStandardMaterial color="#d3dce9" roughness={0.5} metalness={0.15} />
      </mesh>
      {/* tail boom + V-tail */}
      <mesh position={[-4.4, 0, 0]} castShadow>
        <boxGeometry args={[3.4, 0.5, 0.5]} />
        <meshStandardMaterial color="#b9c4d4" roughness={0.55} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[-5.6, 1.1, s * 1.2]} rotation={[s * 0.7, 0, 0]} castShadow>
          <boxGeometry args={[1.8, 0.22, 3.2]} />
          <meshStandardMaterial color="#c9d3e2" roughness={0.55} />
        </mesh>
      ))}
      {/* pusher propeller disc */}
      <mesh position={[-6.4, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[1.5, 1.5, 0.08, 20]} />
        <meshStandardMaterial color="#8fa5c4" transparent opacity={0.35} roughness={0.4} />
      </mesh>
    </group>
  )
}

function Aircraft({ frames, timeRef, autoAdvance, route, onReadout, craftRef }) {
  const yaw = useRef()
  const pitch = useRef()
  const roll = useRef()
  const drop = useRef()
  const routeLength = useMemo(() => route.getLength(), [route])
  const lastPush = useRef(0)

  useFrame((state, delta) => {
    if (!frames.length || !craftRef.current || !yaw.current || !drop.current) return
    const last = frames[frames.length - 1].time

    if (timeRef.current == null) timeRef.current = autoAdvance ? last - LIVE_LAG_MS : frames[0].time
    if (autoAdvance) timeRef.current = Math.min(timeRef.current + delta * 1000, last)

    const frame = frameAt(frames, timeRef.current)
    if (!frame) return

    const u = ((frame.distance / routeLength) % 1 + 1) % 1
    const point = route.getPointAt(u)
    const tangent = route.getTangentAt(u)

    // Vibration shows up as airframe shake, the same reading the engine view
    // uses to shake the engine.
    const shake = Math.min(frame.vibration ?? 0, 2) * 0.35
    const t = state.clock.elapsedTime

    craftRef.current.position.set(
      point.x + Math.sin(t * 21) * shake,
      frame.altitude + Math.sin(t * 27) * shake,
      point.z + Math.cos(t * 17) * shake,
    )

    yaw.current.rotation.y = Math.atan2(-tangent.z, tangent.x)
    pitch.current.rotation.z = Math.max(
      -MAX_PITCH,
      Math.min(MAX_PITCH, Math.atan2(frame.climb, Math.max(frame.speed, 1))),
    )
    // Coordinated turn: tan(bank) = v^2 / (r g), with 1/r the path curvature.
    const curvature = turnAt(route, u)
    roll.current.rotation.x = Math.max(
      -MAX_BANK,
      Math.min(MAX_BANK, Math.atan((frame.speed * frame.speed * curvature) / G)),
    )

    // Line down to the ground, so height above the blocks is readable.
    drop.current.scale.y = Math.max(frame.altitude, 0.1)
    drop.current.position.set(point.x, frame.altitude / 2, point.z)

    if (state.clock.elapsedTime - lastPush.current > 0.12) {
      lastPush.current = state.clock.elapsedTime
      onReadout?.(frame)
    }
  })

  return (
    <>
      <group ref={craftRef}>
        <group ref={yaw}>
          <group ref={pitch}>
            <group ref={roll}>
              <Airframe />
            </group>
          </group>
        </group>
      </group>
      <mesh ref={drop}>
        <boxGeometry args={[0.35, 1, 0.35]} />
        <meshBasicMaterial color="#5b9df0" transparent opacity={0.22} />
      </mesh>
    </>
  )
}

// Keeps the camera's offset from the aircraft while letting the user orbit it.
function FollowCamera({ craftRef, enabled }) {
  const { camera, controls } = useThree()
  const previous = useRef(null)

  useFrame(() => {
    if (!craftRef.current || !controls) return
    const here = craftRef.current.position

    // First frame: drop the camera in behind the aircraft. Without this the
    // view opens on wherever the default camera was pointing, which on a site
    // five kilometres long is usually empty ground.
    if (!previous.current) {
      previous.current = new THREE.Vector3().copy(here)
      camera.position.copy(here).add(CAMERA_OFFSET)
      controls.target.copy(here)
      return
    }

    if (!enabled) {
      previous.current.copy(here)
      return
    }

    tmpVec.subVectors(here, previous.current)
    camera.position.add(tmpVec)
    controls.target.copy(here)
    previous.current.copy(here)
  })

  return null
}

/* -------------------------------------------------------------------- view */

export function FlightScene({ frames, timeRef, autoAdvance = false }) {
  const [follow, setFollow] = useState(true)
  const [readout, setReadout] = useState(null)
  const craftRef = useRef()

  const route = useMemo(() => buildRoute(), [])
  const blocks = useMemo(() => buildCity(route), [route])

  return (
    <div className="flight3d">
      <div className="flight3d__canvas">
        <Canvas shadows dpr={[1, 2]} camera={{ position: [180, 190, 260], fov: 52, near: 1, far: 4000 }}>
          <color attach="background" args={['#091425']} />
          <fog attach="fog" args={['#091425', 420, 1900]} />

          <Suspense fallback={null}>
            <hemisphereLight args={['#8fb3e8', '#070f1d', 1.0]} />
            <SunRig craftRef={craftRef} />
            <directionalLight position={[-300, 200, -400]} intensity={0.6} color="#6f9fe0" />

            <Ground />
            <City blocks={blocks} />
            <RouteTrack route={route} />
            <Aircraft
              frames={frames}
              timeRef={timeRef}
              autoAdvance={autoAdvance}
              route={route}
              craftRef={craftRef}
              onReadout={setReadout}
            />
            <FollowCamera craftRef={craftRef} enabled={follow} />
          </Suspense>

          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minDistance={26}
            maxDistance={1600}
            maxPolarAngle={Math.PI / 2 - 0.03}
          />
        </Canvas>

        <div className="flight3d__hud">
          <button
            type="button"
            className={`btn btn--sm${follow ? ' btn--accent' : ''}`}
            aria-pressed={follow}
            onClick={() => setFollow((v) => !v)}
          >
            {follow ? 'Following' : 'Free look'}
          </button>
        </div>

        {readout && (
          <dl className="flight3d__readout">
            <div>
              <dt>Phase</dt>
              <dd>{PHASES[readout.phase]?.label ?? readout.phase}</dd>
            </div>
            <div>
              <dt>Altitude</dt>
              <dd>
                {Math.round(readout.altitude)} <span>m AGL</span>
              </dd>
            </div>
            <div>
              <dt>Ground speed</dt>
              <dd>
                {Math.round(readout.speed)} <span>m/s</span>
              </dd>
            </div>
            <div>
              <dt>Climb</dt>
              <dd>
                {readout.climb > 0 ? '+' : ''}
                {readout.climb.toFixed(1)} <span>m/s</span>
              </dd>
            </div>
          </dl>
        )}

        <p className="flight3d__caveat">
          Heading, altitude and speed follow the recorded engine readings. Obstacles are an illustrative block
          field, not site data. Ceiling {ALT_MAX} m.
        </p>
      </div>
    </div>
  )
}

export default FlightScene
