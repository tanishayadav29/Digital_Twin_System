// The environment the replayed UAV flies through.
//
// Deliberately rudimentary: an undisclosed site drawn as plain blocks, the way
// an obstacle field is drawn for a flight-planning study rather than a map of
// anywhere real. Nothing here is site data.
//
// The route is a long meander that runs the length of the site and comes back
// on a different line, rather than a circuit - so the aircraft reads as going
// somewhere instead of going round. Blocks stand in a few built-up clusters
// along that route, leaving open ground between them, so the aircraft threads
// past buildings instead of crossing a uniform grid.
//
// Both route and blocks come from a fixed seed, so the site is identical on
// every load and between machines: the same recording always replays through
// the same obstacles.
//
// Units are metres, matching lib/flightPath.js.
import * as THREE from 'three'

const SEED = 0x5eed1234

// mulberry32: small, fast, and repeatable across browsers, which a plain
// Math.random() would not be.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Outbound down the site, weaving either side of the centreline, a wide turn at
// the far end, then home on a parallel line. About 11.6 km end to end, so a five
// minute window is roughly one pass rather than a dozen laps of a ring.
// The weave is long and shallow on purpose: a half wavelength of about 600 m
// against roughly 110 m of swing keeps the turn radius above 300 m, which at
// cruise is a 20-25 degree bank. Tighter waypoints looked like slalom poles and
// pinned the aircraft against its bank limit the whole way down the site.
const ROUTE = [
  [-2200, 120],
  [-1700, -80],
  [-1100, 110],
  [-500, -90],
  [100, 120],
  [700, -80],
  [1300, 110],
  [1900, -60],
  [2350, 120],
  // wide turn at the far end
  [2600, 380],
  [2500, 650],
  [2150, 760],
  // home on a parallel line, weaving the other way
  [1550, 620],
  [950, 740],
  [350, 600],
  [-250, 730],
  [-850, 600],
  [-1450, 730],
  [-2050, 620],
  // and back round, shaped to match the far turn so neither end pins the
  // aircraft against its bank limit any harder than the other
  [-2450, 700],
  [-2650, 470],
  [-2550, 210],
]

export const SITE_LENGTH = 5800 // X extent the ground and grid have to cover

export function buildRoute() {
  return new THREE.CatmullRomCurve3(
    ROUTE.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'catmullrom',
    0.5,
  )
}

// Clearance kept either side of the centreline before a block may stand, so the
// route is always flyable.
const CORRIDOR = 44
const BELT = 78 // blocks stand between CORRIDOR and CORRIDOR + BELT of the track
const STATION = 95 // metres between candidate positions along the route

// A handful of built-up patches rather than buildings the whole way round.
const CLUSTERS = [0.07, 0.24, 0.41, 0.58, 0.79]
const CLUSTER_WIDTH = 0.034

function density(u) {
  let best = 0
  for (const centre of CLUSTERS) {
    // Measured around the loop, so a cluster near 0 also covers the tail end.
    const raw = Math.abs(u - centre)
    const d = Math.min(raw, 1 - raw) / CLUSTER_WIDTH
    best = Math.max(best, Math.exp(-d * d))
  }
  return best
}

// A block is offset from the station it was placed at, but the route meanders
// and may come back past it somewhere else. So every candidate is measured
// against the whole track, not just its own station, and dropped if any part of
// the route passes closer than this to its nearest face.
const MIN_CLEARANCE = 34

export function buildCity(route) {
  const random = rng(SEED)
  const stations = Math.floor(route.getLength() / STATION)

  // Flattened track, sampled once, to test candidates against.
  const spine = route.getSpacedPoints(900).map((p) => new THREE.Vector2(p.x, p.z))
  const here = new THREE.Vector2()

  const clearOfTrack = (x, z, radius) => {
    here.set(x, z)
    for (const s of spine) {
      if (here.distanceTo(s) - radius < MIN_CLEARANCE) return false
    }
    return true
  }

  const blocks = []
  const up = new THREE.Vector3(0, 1, 0)
  const side = new THREE.Vector3()

  for (let i = 0; i < stations; i++) {
    const u = i / stations
    const chance = density(u)

    // Open ground between the clusters.
    if (random() > chance * 0.88) continue

    const point = route.getPointAt(u)
    const tangent = route.getTangentAt(u)
    side.crossVectors(tangent, up).normalize()

    // One block beside the track, and now and then one facing it across the way.
    const sides = random() < 0.3 ? [1, -1] : [random() < 0.5 ? 1 : -1]

    for (const s of sides) {
      const offset = CORRIDOR + random() * BELT
      const width = 24 + random() * 30
      const depth = 24 + random() * 30
      const x = point.x + side.x * offset * s
      const z = point.z + side.z * offset * s

      if (!clearOfTrack(x, z, Math.hypot(width, depth) / 2)) continue

      blocks.push({
        x,
        z,
        width,
        depth,
        // Taller at the heart of each cluster, so a patch has a core.
        height: 18 + random() * 38 + chance * 60,
        mast: random() < 0.2 ? 10 + random() * 24 : 0,
        shade: 0.75 + random() * 0.5,
      })
    }
  }

  return blocks
}

// Curvature at a point along the route, used for the bank angle. Sampled from
// the tangent either side rather than differentiated analytically, which is
// accurate enough at these speeds and far simpler to read.
const DELTA = 0.004 // fraction of the loop

export function turnAt(route, u) {
  const wrap = (v) => ((v % 1) + 1) % 1
  const a = route.getTangentAt(wrap(u - DELTA))
  const b = route.getTangentAt(wrap(u + DELTA))

  const angle = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z)
  const arc = route.getLength() * DELTA * 2

  return arc > 0 ? angle / arc : 0 // radians per metre, signed
}
