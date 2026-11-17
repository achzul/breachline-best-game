// Movement and ray tests against Kestrel Yard's boxes. Actors are upright
// cylinders standing on their feet position; the yard is flat, so boxes are
// walls and cover, with a small step allowance for lips and pads.

import { COLLIDERS } from './world.js';

const STEP = 0.55;
const GRAVITY = 20;

function footprintHits(b, x, z, r) {
  return x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1;
}

// Integrate one actor for dt: horizontal axes resolved separately so actors
// slide along walls, then gravity and support.
export function collideMove(a, dt) {
  const r = a.radius;
  let nx = a.pos.x + a.vel.x * dt;
  for (const b of COLLIDERS) {
    if (b.h > a.pos.y + STEP && footprintHits(b, nx, a.pos.z, r)) { nx = a.pos.x; a.vel.x = 0; break; }
  }
  a.pos.x = nx;
  let nz = a.pos.z + a.vel.z * dt;
  for (const b of COLLIDERS) {
    if (b.h > a.pos.y + STEP && footprintHits(b, a.pos.x, nz, r)) { nz = a.pos.z; a.vel.z = 0; break; }
  }
  a.pos.z = nz;

  a.vel.y -= GRAVITY * dt;
  a.pos.y += a.vel.y * dt;
  let support = 0;
  for (const b of COLLIDERS) {
    if (b.h <= a.pos.y + STEP && footprintHits(b, a.pos.x, a.pos.z, r * 0.7)) {
      support = Math.max(support, b.h);
    }
  }
  if (a.pos.y <= support) {
    a.pos.y = support;
    a.vel.y = 0;
    a.grounded = true;
  } else {
    a.grounded = false;
  }
}

// Ray vs every box (and the ground plane). Returns distance or Infinity.
export function rayWorld(o, d, maxDist) {
  let best = maxDist;
  if (d.y < -1e-8) {
    const t = -o.y / d.y;
    if (t > 0 && t < best) best = t;
  }
  for (const b of COLLIDERS) {
    let t0 = 0, t1 = best;
    // x slab
    if (Math.abs(d.x) < 1e-9) { if (o.x < b.x0 || o.x > b.x1) continue; }
    else {
      let ta = (b.x0 - o.x) / d.x, tb = (b.x1 - o.x) / d.x;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // y slab (boxes stand on the ground)
    if (Math.abs(d.y) < 1e-9) { if (o.y < 0 || o.y > b.h) continue; }
    else {
      let ta = (0 - o.y) / d.y, tb = (b.h - o.y) / d.y;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // z slab
    if (Math.abs(d.z) < 1e-9) { if (o.z < b.z0 || o.z > b.z1) continue; }
    else {
      let ta = (b.z0 - o.z) / d.z, tb = (b.z1 - o.z) / d.z;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (t0 > 0 && t0 < best) best = t0;
  }
  return best;
}

// Is the straight sight line between two points blocked by a wall or by a
// live smoke cloud? Eye and chest heights ride in the points themselves, so
// crouching behind low cover works naturally.
export function sightBlocked(G, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return false;
  const inv = 1 / dist;
  const hit = rayWorld({ x: ax, y: ay, z: az }, { x: dx * inv, y: dy * inv, z: dz * inv }, dist - 0.08);
  if (hit < dist - 0.08) return true;
  for (const s of G.smokes) {
    if (G.time > s.until) continue;
    // distance from the segment to the cloud centre
    const t = Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / (dist * dist)));
    const px = ax + dx * t - s.x, py = ay + dy * t - s.y, pz = az + dz * t - s.z;
    if (px * px + py * py + pz * pz < s.r * s.r * 0.72) return true;
  }
  return false;
}

function raySphere(o, d, cx, cy, cz, r, maxDist) {
  const ox = cx - o.x, oy = cy - o.y, oz = cz - o.z;
  const tca = ox * d.x + oy * d.y + oz * d.z;
  if (tca < 0) return Infinity;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  const t = tca - Math.sqrt(r2 - d2);
  return t > 0 && t < maxDist ? t : Infinity;
}

// Ray vs the enemy actors: a head sphere and two body spheres per actor
// approximate the capsule. Returns {actor, dist, head} or null.
export function rayActor(G, o, d, maxDist, shooter) {
  let best = null;
  for (const a of G.actors) {
    if (!a.alive || a === shooter || a.team === shooter.team) continue;
    const crouch = a.crouch;
    const headY = a.pos.y + (crouch ? 1.06 : 1.5);
    const th = raySphere(o, d, a.pos.x, headY, a.pos.z, 0.24, maxDist);
    if (th < maxDist) { best = { actor: a, dist: th, head: true }; maxDist = th; continue; }
    const b1 = raySphere(o, d, a.pos.x, a.pos.y + (crouch ? 0.62 : 0.92), a.pos.z, 0.47, maxDist);
    const b2 = raySphere(o, d, a.pos.x, a.pos.y + 0.36, a.pos.z, 0.44, maxDist);
    const tb = Math.min(b1, b2);
    if (tb < maxDist) { best = { actor: a, dist: tb, head: false }; maxDist = tb; }
  }
  return best;
}
