// The 3D view of the engine: a real-time WebGL twin that turns at the RPM the
// telemetry is reporting and colours each casting by the health lib/health.js
// worked out for it.
//
// Orbit with the left mouse button (360 degrees around and up to nearly
// overhead or underneath), zoom with the wheel, pan with the right button.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Html, OrbitControls } from '@react-three/drei'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import * as THREE from 'three'
import { PART_BY_ID } from '../../config/engineParts.js'
import { GROUND_Y, PART_FOCUS, SPEC, VISUAL_SPIN } from '../../config/engine3d.js'
import { EngineModel } from './EngineModel.jsx'

const pct = (health) => (health == null ? '—' : `${Math.round(health * 100)}%`)

// Reflections without fetching an HDR: three's own room scene, baked once.
function StudioLighting() {
  const { scene, gl } = useThree()

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const target = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = target.texture
    scene.environmentIntensity = 0.55
    return () => {
      scene.environment = null
      target.dispose()
      pmrem.dispose()
    }
  }, [scene, gl])

  return (
    <>
      <hemisphereLight args={['#93b4e8', '#0a1426', 0.75]} />
      <directionalLight
        position={[6, 8, 5]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
      />
      <directionalLight position={[-7, 3, -6]} intensity={0.8} color="#7fb0ff" />
      <directionalLight position={[0, -5, 3]} intensity={0.35} color="#cfe0ff" />
    </>
  )
}

// Advances the crank and propeller from the live RPM, and shakes the engine in
// proportion to the vibration reading. Runs before every other frame callback.
function Motion({ spin, rpm, vibration, stale, running, engineRef }) {
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const revPerSec = !running || stale ? 0 : ((rpm ?? 0) / 60) * VISUAL_SPIN

    spin.current.theta += revPerSec * dt * Math.PI * 2
    spin.current.prop += (revPerSec / SPEC.gearboxRatio) * dt * Math.PI * 2

    if (engineRef.current) {
      const amp = !running || stale ? 0 : Math.min(vibration ?? 0, 2) * 0.014
      const t = state.clock.elapsedTime
      engineRef.current.position.y = Math.sin(t * 33) * amp
      engineRef.current.position.z = Math.cos(t * 26) * amp * 0.7
    }
  }, -1)

  return null
}

function Tag({ id, health, selected }) {
  const info = health[id] ?? { status: 'nodata', health: null }
  const part = PART_BY_ID[id]
  if (!part) return null

  return (
    <Html position={PART_FOCUS[id] ?? [0, 0, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`eng3d__tag eng3d__tag--${info.status}${selected ? ' is-selected' : ''}`}>
        <span className="eng3d__tag-name">{part.short ?? part.label}</span>
        <span className="eng3d__tag-pct">{pct(info.health)}</span>
      </div>
    </Html>
  )
}

export function Engine3D({ health, selected, onSelect, telemetry, stale }) {
  const [hovered, setHovered] = useState(null)
  const [xray, setXray] = useState(true)
  const [showAllTags, setShowAllTags] = useState(false)
  const [running, setRunning] = useState(true)

  const spin = useRef({ theta: 0, prop: 0 })
  const engineRef = useRef()
  const controlsRef = useRef()

  const rpm = telemetry?.values?.rpm
  const vibration = telemetry?.values?.vibration

  const state = useMemo(
    () => ({ health, selected, hovered, onSelect, onHover: setHovered, xray }),
    [health, selected, hovered, onSelect, xray],
  )

  const tagIds = showAllTags
    ? Object.keys(PART_FOCUS)
    : [selected, hovered].filter((id, i, all) => id && all.indexOf(id) === i)

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [hovered])

  const propRpm = rpm == null || stale ? null : Math.round(rpm / SPEC.gearboxRatio)

  return (
    <div className="eng3d">
      <div className="eng3d__canvas">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [5.4, 3.0, 6.6], fov: 38, near: 0.1, far: 120 }}
          onPointerMissed={() => setHovered(null)}
          gl={{ antialias: true }}
        >
          <color attach="background" args={['#0b1628']} />
          <fog attach="fog" args={['#0b1628', 18, 40]} />

          <Suspense fallback={null}>
            <StudioLighting />
            <Motion
              spin={spin}
              rpm={rpm}
              vibration={vibration}
              stale={stale}
              running={running}
              engineRef={engineRef}
            />

            <group ref={engineRef}>
              <EngineModel state={state} spin={spin} />
              {tagIds.map((id) => (
                <Tag key={id} id={id} health={health} selected={selected === id} />
              ))}
            </group>

            <ContactShadows position={[0, GROUND_Y, 0]} opacity={0.5} scale={18} blur={2.6} far={5} resolution={512} />
            <gridHelper args={[28, 28, '#1c3055', '#132340']} position={[0, GROUND_Y - 0.01, 0]} />
          </Suspense>

          <OrbitControls
            ref={controlsRef}
            makeDefault
            target={[0, -0.1, 0]}
            minDistance={3.4}
            maxDistance={24}
            minPolarAngle={0.12}
            maxPolarAngle={Math.PI - 0.12}
            enableDamping
            dampingFactor={0.08}
          />
        </Canvas>

        <div className="eng3d__hud">
          <button
            type="button"
            className={`btn btn--sm${xray ? ' btn--accent' : ''}`}
            aria-pressed={xray}
            onClick={() => setXray((v) => !v)}
          >
            Cutaway
          </button>
          <button
            type="button"
            className={`btn btn--sm${showAllTags ? ' btn--accent' : ''}`}
            aria-pressed={showAllTags}
            onClick={() => setShowAllTags((v) => !v)}
          >
            All labels
          </button>
          <button
            type="button"
            className={`btn btn--sm${running ? ' btn--accent' : ''}`}
            aria-pressed={running}
            onClick={() => setRunning((v) => !v)}
          >
            {running ? 'Running' : 'Frozen'}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => controlsRef.current?.reset()}>
            Reset view
          </button>
        </div>

        <p className="eng3d__readout">
          {stale || rpm == null ? (
            'No live reading — engine held still'
          ) : (
            <>
              Crank <strong>{Math.round(rpm)}</strong> rpm · propeller <strong>{propRpm}</strong> rpm through the{' '}
              {SPEC.gearboxRatio}:1 drive
            </>
          )}
        </p>
      </div>

      <p className="eng3d__hint">
        Drag to orbit · wheel to zoom · right-drag to pan · click any part for its readings
      </p>
    </div>
  )
}

export default Engine3D
