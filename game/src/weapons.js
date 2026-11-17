// One shared combat model for the player and every bot: hitscan with range
// falloff, headshots, armour absorption, movement/recoil bloom, magazines
// and reloads — plus the three grenades, which fly, bounce and go off
// through the same physics as everything else.

import { rayWorld, rayActor, sightBlocked } from './physics.js';
import { bell } from './rng.js';

export const HEAD_MUL = 4;

export const WEAPONS = {
  wasp: { name: 'P9 Wasp', price: 0, dmg: 34, rpm: 380, auto: false, mag: 12, reserve: 48, reload: 1.35, spread: 0.7, pellets: 1, near: 18, far: 46, min: 0.55, range: 80, kick: 0.5 },
  raptor: { name: 'Raptor-9 SMG', price: 1500, dmg: 26, rpm: 790, auto: true, mag: 32, reserve: 128, reload: 1.9, spread: 1.15, pellets: 1, near: 12, far: 36, min: 0.45, range: 70, kick: 0.35 },
  mule: { name: 'Mule 12G', price: 1700, dmg: 11, rpm: 70, auto: false, mag: 6, reserve: 30, reload: 2.6, spread: 4.6, pellets: 8, near: 8, far: 22, min: 0.3, range: 40, kick: 1.5 },
  vk7: { name: 'VK-7 Carbine', price: 2700, dmg: 33, rpm: 650, auto: true, mag: 30, reserve: 120, reload: 2.0, spread: 0.8, pellets: 1, near: 25, far: 62, min: 0.65, range: 110, kick: 0.55 },
  longbow: { name: 'Longbow-7 DMR', price: 3400, dmg: 68, rpm: 150, auto: false, mag: 10, reserve: 40, reload: 2.3, spread: 0.22, pellets: 1, near: 40, far: 95, min: 0.8, range: 160, kick: 1.0, zoom: 2.6 },
};

export const SHOP = [
  { key: 'Digit1', slot: 'primary', id: 'raptor', label: 'Raptor-9 SMG', price: 1500 },
  { key: 'Digit2', slot: 'primary', id: 'mule', label: 'Mule 12G', price: 1700 },
  { key: 'Digit3', slot: 'primary', id: 'vk7', label: 'VK-7 Carbine', price: 2700 },
  { key: 'Digit4', slot: 'primary', id: 'longbow', label: 'Longbow-7 DMR', price: 3400 },
  { key: 'Digit5', slot: 'armor', id: 'vest', label: 'Kevlar Vest', price: 650 },
  { key: 'Digit6', slot: 'grenade', id: 'frag', label: 'Frag Grenade', price: 300 },
  { key: 'Digit7', slot: 'grenade', id: 'smoke', label: 'Smoke Grenade', price: 300 },
  { key: 'Digit8', slot: 'grenade', id: 'flash', label: 'Flash Grenade', price: 200 },
];
export const GRENADE_CAPS = { frag: 2, smoke: 1, flash: 2 };

export function newGun(id) {
  const w = WEAPONS[id];
  return { id, mag: w.mag, reserve: w.reserve };
}

export function gunOf(actor) {
  return actor.slot === 'primary' && actor.weapons.primary ? actor.weapons.primary : actor.weapons.sidearm;
}

export function eyePos(a) {
  return { x: a.pos.x, y: a.pos.y + (a.crouch ? 1.12 : 1.58), z: a.pos.z };
}

export function aimDir(a) {
  const cp = Math.cos(a.pitch);
  return { x: -Math.sin(a.yaw) * cp, y: Math.sin(a.pitch), z: -Math.cos(a.yaw) * cp };
}

function falloff(w, d) {
  if (d <= w.near) return 1;
  if (d >= w.far) return w.min;
  return 1 - (1 - w.min) * ((d - w.near) / (w.far - w.near));
}

// Finish a reload whose time has come (called for every actor each step).
export function serviceWeapon(G, a) {
  if (a.reloadEnd && G.time >= a.reloadEnd) {
    const gun = gunOf(a);
    const w = WEAPONS[gun.id];
    const take = Math.min(w.mag - gun.mag, gun.reserve);
    gun.mag += take;
    gun.reserve -= take;
    a.reloadEnd = 0;
  }
  a.bloom = Math.max(0, a.bloom - 0.055); // per-step decay at 60 Hz
}

export function startReload(G, a) {
  const gun = gunOf(a);
  const w = WEAPONS[gun.id];
  if (a.reloadEnd || gun.mag >= w.mag || gun.reserve <= 0) return;
  a.reloadEnd = G.time + w.reload;
  G.events.push({ type: 'reload', actor: a });
}

export function tryFire(G, a) {
  if (!a.alive || a.reloadEnd) return false;
  const gun = gunOf(a);
  const w = WEAPONS[gun.id];
  const trigger = w.auto ? a.wantFire : a.wantFireEdge;
  if (!trigger) return false;
  if (G.time < a.nextShotAt) return false;
  if (gun.mag <= 0) {
    a.nextShotAt = G.time + 0.3;
    startReload(G, a);
    G.events.push({ type: 'dry', actor: a });
    return false;
  }
  a.nextShotAt = G.time + 60 / w.rpm;
  gun.mag--;
  a.shotsFired++;
  a.bloom = Math.min(1.3, a.bloom + (w.pellets > 1 ? 0.5 : 0.14));

  const speed = Math.hypot(a.vel.x, a.vel.z);
  let spreadDeg = w.spread * (1 + a.bloom * 0.9) * (1 + (speed / 4.6) * 0.85);
  if (a.aiming) spreadDeg *= 0.35;
  if (a.crouch) spreadDeg *= 0.8;
  if (a.bot) spreadDeg += a.bot.aimErr * (0.65 + 0.45 * (a.bot.targetSpeed / 4.5));

  const o = eyePos(a);
  const base = aimDir(a);
  const right = { x: Math.cos(a.yaw), y: 0, z: -Math.sin(a.yaw) };
  const up = {
    x: -Math.sin(a.yaw) * Math.sin(a.pitch) * -1, y: Math.cos(a.pitch), z: -Math.cos(a.yaw) * Math.sin(a.pitch) * -1,
  };
  const spreadRad = (spreadDeg * Math.PI) / 180;
  const muzzle = { x: o.x + base.x * 0.5, y: o.y + base.y * 0.5 - 0.06, z: o.z + base.z * 0.5 };
  G.events.push({ type: 'muzzle', actor: a, x: muzzle.x, y: muzzle.y, z: muzzle.z });
  G.events.push({ type: 'shot', actor: a, weapon: gun.id, x: o.x, y: o.y, z: o.z });
  G.noise.push({ x: a.pos.x, z: a.pos.z, t: G.time, team: a.team });
  a.recoil = Math.min(1.5, (a.recoil || 0) + w.kick);

  for (let p = 0; p < w.pellets; p++) {
    const sx = bell(G.rng) * spreadRad, sy = bell(G.rng) * spreadRad;
    let dx = base.x + right.x * sx + up.x * sy;
    let dy = base.y + right.y * sx + up.y * sy;
    let dz = base.z + right.z * sx + up.z * sy;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const d = { x: dx, y: dy, z: dz };
    const wallDist = rayWorld(o, d, w.range);
    const hit = rayActor(G, o, d, Math.min(wallDist, w.range), a);
    const endDist = hit ? hit.dist : wallDist;
    G.events.push({
      type: 'tracer',
      x0: muzzle.x, y0: muzzle.y, z0: muzzle.z,
      x1: o.x + dx * endDist, y1: o.y + dy * endDist, z1: o.z + dz * endDist,
      team: a.team,
    });
    if (hit) {
      const dmg = w.dmg * falloff(w, hit.dist) * (hit.head ? HEAD_MUL : 1);
      applyDamage(G, hit.actor, a, dmg, hit.head, gun.id);
    } else if (wallDist < w.range) {
      G.events.push({ type: 'impact', x: o.x + dx * wallDist, y: o.y + dy * wallDist, z: o.z + dz * wallDist });
    }
  }
  if (gun.mag === 0) startReload(G, a);
  return true;
}

export function applyDamage(G, victim, attacker, raw, head, cause) {
  if (!victim.alive || raw <= 0) return;
  let dmg = raw;
  if (victim.armor > 0) {
    const absorbed = Math.min(raw * (head ? 0.25 : 0.55), victim.armor);
    victim.armor -= absorbed;
    dmg = raw - absorbed;
  }
  victim.hp -= dmg;
  victim.lastAttacker = attacker;
  if (attacker && attacker.isPlayer && victim.team !== attacker.team) {
    G.events.push({ type: head ? 'hitmarkHead' : 'hitmark', actor: attacker });
  }
  if (victim.hp > 0) return;
  victim.hp = 0;
  victim.alive = false;
  victim.deathT = 0;
  victim.deaths++;
  victim.channeling = null;
  if (attacker && attacker !== victim && attacker.team !== victim.team) {
    attacker.kills++;
    attacker.money += 300;
    if (attacker.isPlayer) G.events.push({ type: 'killConfirm', actor: attacker });
  }
  G.killfeed.push({
    text: `${attacker ? attacker.name : '—'}  ▸  ${victim.name}${head ? '  (headshot)' : ''}${cause === 'frag' ? '  (frag)' : ''}`,
    t: G.time, team: attacker ? attacker.team : null,
  });
  G.events.push({ type: 'kill', actor: victim, attacker });
  if (G.charge.carrier === victim && G.charge.state === 'carried') {
    G.charge.state = 'dropped';
    G.charge.carrier = null;
    G.charge.pos = { x: victim.pos.x, z: victim.pos.z };
    G.events.push({ type: 'banner', text: 'CHARGE DROPPED', sub: '', ms: 1400 });
  }
}

// ------------------------------------------------------------ grenades ---

let grenadeSeq = 1;

export function throwGrenade(G, a, kind) {
  if (!a.alive || a.grenades[kind] <= 0) return false;
  a.grenades[kind]--;
  const o = eyePos(a);
  const d = aimDir(a);
  G.grenades.push({
    id: grenadeSeq++, kind, thrower: a,
    x: o.x + d.x * 0.4, y: o.y + 0.1, z: o.z + d.z * 0.4,
    vx: d.x * 13.5, vy: d.y * 13.5 + 2.4, vz: d.z * 13.5,
    fuse: kind === 'frag' ? 1.6 : 1.15, rest: false,
  });
  G.events.push({ type: 'throw', actor: a });
  return true;
}

function explodeFrag(G, n) {
  G.events.push({ type: 'boom', x: n.x, y: n.y, z: n.z });
  for (const a of G.actors) {
    if (!a.alive) continue;
    const c = { x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z };
    const dist = Math.hypot(c.x - n.x, c.y - n.y, c.z - n.z);
    if (dist > 5.6) continue;
    if (sightBlocked(G, n.x, n.y + 0.3, n.z, c.x, c.y, c.z)) continue;
    const dmg = 95 - (95 - 12) * (dist / 5.6);
    if (a !== n.thrower || dist > 1.2) applyDamage(G, a, n.thrower, dmg, false, 'frag');
  }
}

function popFlash(G, n) {
  G.events.push({ type: 'pop', x: n.x, y: n.y, z: n.z });
  for (const a of G.actors) {
    if (!a.alive) continue;
    const eye = eyePos(a);
    const dist = Math.hypot(n.x - eye.x, n.y - eye.y, n.z - eye.z);
    if (dist > 19) continue;
    if (sightBlocked(G, n.x, n.y, n.z, eye.x, eye.y, eye.z)) continue;
    const f = aimDir(a);
    const inv = 1 / (dist || 1);
    const facing = f.x * (n.x - eye.x) * inv + f.y * (n.y - eye.y) * inv + f.z * (n.z - eye.z) * inv;
    const strength = Math.max(0, (facing + 0.35) / 1.35) * (1 - dist / 19);
    if (strength > 0.15) {
      a.blindUntil = Math.max(a.blindUntil || 0, G.time + 0.5 + 2.6 * strength);
      if (a.isPlayer) G.events.push({ type: 'flashed', strength });
    }
  }
}

export function updateGrenades(G, dt) {
  const keep = [];
  for (const n of G.grenades) {
    n.fuse -= dt;
    if (n.fuse <= 0) {
      if (n.kind === 'frag') explodeFrag(G, n);
      else if (n.kind === 'flash') popFlash(G, n);
      else {
        G.smokes.push({ id: n.id, x: n.x, y: 1.25, z: n.z, r: 3.1, born: G.time, until: G.time + 10.5 });
        G.events.push({ type: 'smokeBurst', x: n.x, y: n.y, z: n.z });
      }
      continue;
    }
    if (!n.rest) {
      n.vy -= 14 * dt;
      let px = n.x + n.vx * dt, py = n.y + n.vy * dt, pz = n.z + n.vz * dt;
      if (py < 0.18) {
        py = 0.18;
        n.vy = Math.abs(n.vy) > 1.2 ? -n.vy * 0.38 : 0;
        n.vx *= 0.72; n.vz *= 0.72;
        if (n.vy === 0 && Math.hypot(n.vx, n.vz) < 0.4) n.rest = true;
      }
      // bounce out of boxes: reflect on the axis of least penetration
      for (const b of G.collidersCache) {
        if (px > b.x0 - 0.15 && px < b.x1 + 0.15 && pz > b.z0 - 0.15 && pz < b.z1 + 0.15 && py < b.h + 0.15) {
          const dxl = px - (b.x0 - 0.15), dxr = (b.x1 + 0.15) - px;
          const dzl = pz - (b.z0 - 0.15), dzr = (b.z1 + 0.15) - pz;
          const m = Math.min(dxl, dxr, dzl, dzr);
          if (m === dxl) { px = b.x0 - 0.15; n.vx = -Math.abs(n.vx) * 0.38; }
          else if (m === dxr) { px = b.x1 + 0.15; n.vx = Math.abs(n.vx) * 0.38; }
          else if (m === dzl) { pz = b.z0 - 0.15; n.vz = -Math.abs(n.vz) * 0.38; }
          else { pz = b.z1 + 0.15; n.vz = Math.abs(n.vz) * 0.38; }
        }
      }
      n.x = px; n.y = py; n.z = pz;
    }
    keep.push(n);
  }
  G.grenades = keep;
  if (G.smokes.length) G.smokes = G.smokes.filter((s) => G.time <= s.until);
}
