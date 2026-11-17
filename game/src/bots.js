// Bot brains: perception (vision cone + line of sight, gunfire noise,
// six-second memory), team plans for both sides, burst combat and shopping.
//
// Jackal plan: a carrier and two push bots take one site together — the
// carrier stages at the site entry with its escorts instead of rushing in
// alone, the escorts follow through and hold the site while it plants, and
// a carrier mid-plant only breaks off for a close, visible threat. A mid
// and a lurk bot apply pressure and commit on first contact. Wardens hold
// guard spots, intercept fresh contacts, rotate on a planted Charge, and
// the nearest one defuses under cover of the others.

import { SITES, SITE_SPOTS, findPath } from './world.js';
import { sightBlocked, collideMove } from './physics.js';
import { eyePos, gunOf, newGun, WEAPONS, GRENADE_CAPS, startReload, throwGrenade } from './weapons.js';
import { range, chance } from './rng.js';

export function makeBot(rng) {
  return {
    role: 'guard', plan: null, guardSite: null, guardSpot: null, holdSpot: null,
    path: [], pathI: 0, pathTarget: null, repathT: 0,
    thinkT: Math.random() * 0.12, visible: null,
    lastSeen: null, lastSeenT: -99, targetSpeed: 0,
    skill: range(rng, 0.85, 1.15), aimErr: range(rng, 1.7, 2.7),
    burstT: 0, pauseT: 0, lastEdgeT: 0,
    strafeDir: 1, strafeT: 0, aimHead: false,
    moveTarget: null, moveSpeed: 4.35, grenadeCd: 0, stageT: 0,
  };
}

function yawToward(a, x, z) {
  return Math.atan2(-(x - a.pos.x), -(z - a.pos.z));
}

function turnToward(a, want, dt, rate = 6.5) {
  let d = want - a.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, d));
  a.yaw += step;
}

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// ------------------------------------------------------------- planning ---

export function assignPlans(G) {
  const rng = G.rng;
  const jackals = G.actors.filter((a) => a.team === 'J');
  const wardens = G.actors.filter((a) => a.team === 'W' && a.bot);
  // pick the attack site, avoiding three straight hits on the same one
  let siteId = chance(rng, 0.5) ? 'A' : 'B';
  if (G.siteStreak && G.siteStreak.id === siteId && G.siteStreak.n >= 2) siteId = siteId === 'A' ? 'B' : 'A';
  G.siteStreak = G.siteStreak && G.siteStreak.id === siteId
    ? { id: siteId, n: G.siteStreak.n + 1 } : { id: siteId, n: 1 };
  const site = SITES[siteId];
  const carrier = jackals[G.round % jackals.length];
  const rest = jackals.filter((a) => a !== carrier);
  const roles = ['push', 'push', 'mid', 'lurk'];
  jackals.forEach((a, i) => {
    const b = a.bot;
    b.role = a === carrier ? 'carrier' : roles[i - (jackals.indexOf(carrier) < i ? 1 : 0)] || 'push';
    if (a !== carrier) b.role = roles[rest.indexOf(a)] || 'push';
    b.plan = { site, stage: 0 };
    b.stageT = 0;
    b.holdSpot = SITE_SPOTS[siteId].hold[a.id % 2];
    b.path = []; b.pathTarget = null; b.visible = null;
    b.lastSeen = null; b.lastSeenT = -99; b.moveTarget = null;
  });
  G.charge.carrier = carrier;
  G.charge.state = 'carried';
  wardens.forEach((a, i) => {
    const b = a.bot;
    const sid = i < 2 ? 'A' : 'B';
    b.role = 'guard';
    b.guardSite = sid;
    b.guardSpot = SITE_SPOTS[sid].guards[i % 2];
    b.path = []; b.pathTarget = null; b.visible = null;
    b.lastSeen = null; b.lastSeenT = -99; b.moveTarget = null;
  });
}

function shopBot(G, a) {
  const rng = G.rng;
  if (!a.weapons.primary) {
    if (a.money >= 2700 && chance(rng, 0.55)) buyPrimary(a, 'vk7');
    else if (a.money >= 1700 && chance(rng, 0.3)) buyPrimary(a, 'mule');
    else if (a.money >= 1500) buyPrimary(a, 'raptor');
  }
  if (a.armor <= 0 && a.money >= 650 && chance(rng, 0.85)) { a.armor = 100; a.money -= 650; }
  if (a.money >= 900) {
    if (a.grenades.frag < GRENADE_CAPS.frag && chance(rng, 0.5)) { a.grenades.frag++; a.money -= 300; }
    if (a.bot && a.bot.role === 'carrier' && a.grenades.smoke < 1 && chance(rng, 0.6)) { a.grenades.smoke++; a.money -= 300; }
    if (a.grenades.flash < GRENADE_CAPS.flash && chance(rng, 0.3)) { a.grenades.flash++; a.money -= 200; }
  }
}

function buyPrimary(a, id) {
  a.weapons.primary = newGun(id);
  a.money -= WEAPONS[id].price;
  a.slot = 'primary';
}

export function shopAll(G) {
  for (const a of G.actors) if (a.bot) shopBot(G, a);
}

// ----------------------------------------------------------- perception ---

function perceive(G, a) {
  const b = a.bot;
  b.visible = null;
  if (G.time < a.blindUntil) return;
  const eye = eyePos(a);
  let best = null, bestD = 58;
  for (const e of G.actors) {
    if (!e.alive || e.team === a.team) continue;
    const d = Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z);
    if (d > 58) continue;
    if (d > 4) {
      const want = yawToward(a, e.pos.x, e.pos.z);
      let dd = want - a.yaw;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      if (Math.abs(dd) > 1.02) continue; // ~58 degree half-cone
    }
    const chest = { x: e.pos.x, y: e.pos.y + (e.crouch ? 0.75 : 1.05), z: e.pos.z };
    if (sightBlocked(G, eye.x, eye.y, eye.z, chest.x, chest.y, chest.z)) continue;
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best) {
    b.visible = best;
    b.lastSeen = { x: best.pos.x, z: best.pos.z };
    b.lastSeenT = G.time;
    b.targetSpeed = Math.hypot(best.vel.x, best.vel.z);
    return;
  }
  // gunfire noise: a recent shot from an enemy within earshot
  for (const n of G.noise) {
    if (n.team === a.team || G.time - n.t > 2.5) continue;
    if (Math.hypot(n.x - a.pos.x, n.z - a.pos.z) > 26) continue;
    if (n.t > b.lastSeenT) { b.lastSeen = { x: n.x, z: n.z }; b.lastSeenT = n.t; }
  }
}

function teamContact(G, team) {
  return G.actors.some((a) => a.team === team && a.bot && G.time - a.bot.lastSeenT < 4);
}

function threatBlocksPlant(G, a) {
  const b = a.bot;
  if (b.visible && dist2D(a.pos, b.visible.pos) < 12) return true;
  if (b.lastSeen && G.time - b.lastSeenT <= 2 && Math.hypot(b.lastSeen.x - a.pos.x, b.lastSeen.z - a.pos.z) < 7) return true;
  return false;
}

// ------------------------------------------------------------- deciding ---

function decide(G, a) {
  const b = a.bot;
  b.moveTarget = null;
  b.moveSpeed = 4.35;
  const site = b.plan ? b.plan.site : null;

  // A dropped Charge pulls the nearest Jackal onto it (they become the
  // carrier again, with the plan attached — see rounds.js pickup).
  if (a.team === 'J' && G.charge.state === 'dropped') {
    const mates = G.actors.filter((x) => x.team === 'J' && x.alive);
    const nearest = mates.reduce((m, x) => (dist2D(x.pos, G.charge.pos) < dist2D(m.pos, G.charge.pos) ? x : m), mates[0]);
    if (nearest === a && !b.visible) { b.moveTarget = { ...G.charge.pos }; return; }
  }

  if (G.phase === 'planted') {
    decidePlanted(G, a);
    return;
  }
  if (G.phase !== 'live') return;

  if (a.team === 'W') { decideGuard(G, a); return; }

  // Jackal attack roles
  const entry = SITE_SPOTS[site.id].entry;
  if (b.role === 'carrier') {
    if (G.charge.carrier !== a) { b.moveTarget = b.holdSpot; return; }
    if (b.plan.stage === 0) {
      b.moveTarget = entry;
      const mates = G.actors.filter((x) => x.team === 'J' && x.alive && x.bot && x.bot.role === 'push');
      const gathered = mates.length === 0 || mates.every((x) => dist2D(x.pos, entry) < 8);
      if (dist2D(a.pos, entry) < 2.4) b.stageT += 0.12; else b.stageT = 0;
      if ((gathered && b.stageT > 0.2) || b.stageT > 4.5) b.plan.stage = 1;
    } else {
      const plantPoint = { x: site.x, z: site.z };
      if (dist2D(a.pos, plantPoint) > 1.5) b.moveTarget = plantPoint;
      else if (!threatBlocksPlant(G, a)) a.channeling = { kind: 'plant' };
    }
  } else if (b.role === 'push') {
    const carrier = G.charge.carrier;
    const carrierIn = carrier && carrier.bot && carrier.bot.plan && carrier.bot.plan.stage >= 1;
    if (b.plan.stage === 0 && (carrierIn || G.time - G.roundStartT > 7)) b.plan.stage = 1;
    b.moveTarget = b.plan.stage === 0 ? entry : b.holdSpot;
  } else if (b.role === 'mid') {
    const midPoint = site.id === 'A' ? { x: -4, z: -4 } : { x: 4, z: 4 };
    const commit = teamContact(G, 'J') || G.deathsThisRound > 0 || G.time - G.roundStartT > 32;
    if (b.plan.stage === 0 && commit) b.plan.stage = 1;
    b.moveTarget = b.plan.stage === 0 ? midPoint : entry;
    if (b.plan.stage === 1 && dist2D(a.pos, entry) < 2.5) b.moveTarget = b.holdSpot;
  } else if (b.role === 'lurk') {
    const other = site.id === 'A' ? SITES.B : SITES.A;
    const otherEntry = SITE_SPOTS[other.id].entry;
    const commit = teamContact(G, 'J') || G.deathsThisRound > 0 || G.time - G.roundStartT > 40;
    if (b.plan.stage === 0 && commit) b.plan.stage = 1;
    b.moveSpeed = b.plan.stage === 0 ? 3.4 : 4.35;
    b.moveTarget = b.plan.stage === 0 ? otherEntry : SITE_SPOTS[other.id].hold[a.id % 2];
  }
}

function decideGuard(G, a) {
  const b = a.bot;
  const mySite = SITES[b.guardSite];
  const seenHere = b.lastSeen && G.time - b.lastSeenT < 6 &&
    Math.hypot(b.lastSeen.x - mySite.x, b.lastSeen.z - mySite.z) < 20;
  if (seenHere) { b.moveTarget = b.lastSeen; return; }
  // rotate: the second guard of a quiet site answers a loud other site
  const other = b.guardSite === 'A' ? SITES.B : SITES.A;
  const loudThere = G.actors.some((x) => x.team === 'W' && x.bot && x.bot.guardSite === other.id &&
    G.time - x.bot.lastSeenT < 5);
  const amRotator = G.actors.filter((x) => x.team === 'W' && x.bot && x.bot.guardSite === b.guardSite)[1] === a;
  if (loudThere && amRotator && G.time - b.lastSeenT > 9) {
    b.moveTarget = SITE_SPOTS[other.id].guards[a.id % 2];
    return;
  }
  b.moveTarget = b.guardSpot;
}

function decidePlanted(G, a) {
  const b = a.bot;
  const chargeSite = Math.hypot(G.charge.pos.x - SITES.A.x, G.charge.pos.z - SITES.A.z) <
    Math.hypot(G.charge.pos.x - SITES.B.x, G.charge.pos.z - SITES.B.z) ? SITES.A : SITES.B;
  if (a.team === 'J') {
    b.moveTarget = SITE_SPOTS[chargeSite.id].hold[a.id % 2];
    return;
  }
  // Wardens: the nearest bot defuses, the rest cover from guard spots.
  const bots = G.actors.filter((x) => x.team === 'W' && x.alive && x.bot);
  const nearest = bots.reduce((m, x) => (dist2D(x.pos, G.charge.pos) < dist2D(m.pos, G.charge.pos) ? x : m), bots[0]);
  if (nearest === a) {
    if (dist2D(a.pos, G.charge.pos) > 1.9) b.moveTarget = { ...G.charge.pos };
    else if (!b.visible || dist2D(a.pos, b.visible.pos) > 6) a.channeling = { kind: 'defuse' };
  } else {
    b.moveTarget = SITE_SPOTS[chargeSite.id].guards[a.id % 2];
  }
}

// --------------------------------------------------------------- acting ---

function followPath(G, a, target, speed, dt) {
  const b = a.bot;
  if (!b.pathTarget || Math.hypot(b.pathTarget.x - target.x, b.pathTarget.z - target.z) > 3 || G.time > b.repathT) {
    b.path = findPath(a.pos, target);
    b.pathI = 0;
    b.pathTarget = { x: target.x, z: target.z };
    b.repathT = G.time + 1.5;
  }
  const wp = b.path[Math.min(b.pathI, b.path.length - 1)];
  if (!wp) { a.vel.x = 0; a.vel.z = 0; return; }
  if (Math.hypot(target.x - a.pos.x, target.z - a.pos.z) < 0.6) { a.vel.x = 0; a.vel.z = 0; return; }
  if (Math.hypot(wp.x - a.pos.x, wp.z - a.pos.z) < 1.05 && b.pathI < b.path.length - 1) b.pathI++;
  const dx = wp.x - a.pos.x, dz = wp.z - a.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  a.vel.x = (dx / len) * speed;
  a.vel.z = (dz / len) * speed;
  if (!b.visible) turnToward(a, Math.atan2(-dx, -dz), dt, 5);
}

function act(G, a, dt) {
  const b = a.bot;
  const canFight = G.phase === 'live' || G.phase === 'planted';

  // channelling bots stand and work; a plant only breaks for a close,
  // visible threat, a defuse for one at arm's length
  if (a.channeling) {
    const threat = b.visible ? dist2D(a.pos, b.visible.pos) : Infinity;
    const limit = a.channeling.kind === 'plant' ? 8 : 6;
    if (!canFight || threat < limit) a.channeling = null;
    else { a.vel.x = 0; a.vel.z = 0; a.wantFire = false; a.wantFireEdge = false; return; }
  }

  const vis = canFight ? b.visible : null;
  if (vis) {
    // combat: face the target, manage distance, strafe, fire in bursts
    const dx = vis.pos.x - a.pos.x, dz = vis.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    turnToward(a, Math.atan2(-dx, -dz), dt, 6.5);
    const eye = eyePos(a);
    const targetY = vis.pos.y + (b.aimHead ? (vis.crouch ? 1.06 : 1.5) : 0.95);
    a.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(targetY - eye.y, Math.max(1, dist))));
    const w = WEAPONS[gunOf(a).id];
    let tx = null, tz = null, spd = 4.0;
    if (dist > w.far * 0.95) { tx = vis.pos.x; tz = vis.pos.z; }
    else {
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafeT = range(G.rng, 0.7, 1.4); b.strafeDir = chance(G.rng, 0.5) ? 1 : -1; }
      const px = (-dz / (dist || 1)) * b.strafeDir, pz = (dx / (dist || 1)) * b.strafeDir;
      tx = a.pos.x + px * 3; tz = a.pos.z + pz * 3;
      spd = 2.6;
      if (dist < 5) { tx = a.pos.x - dx * 0.2; tz = a.pos.z - dz * 0.2; }
    }
    // move directly (short tactical steps, no pathing) but respect walls
    const mdx = tx - a.pos.x, mdz = tz - a.pos.z;
    const ml = Math.hypot(mdx, mdz) || 1;
    a.vel.x = (mdx / ml) * spd;
    a.vel.z = (mdz / ml) * spd;
    a.crouch = dist > 16 && b.strafeDir > 0;
    // burst discipline
    if (G.time < b.pauseT) { a.wantFire = false; a.wantFireEdge = false; }
    else {
      a.wantFire = true;
      if (G.time - b.lastEdgeT > 0.09) { a.wantFireEdge = true; b.lastEdgeT = G.time; }
      if (b.burstT === 0) b.burstT = G.time + range(G.rng, 0.25, 0.55) * b.skill;
      if (G.time > b.burstT) { b.burstT = 0; b.pauseT = G.time + range(G.rng, 0.3, 0.62) / b.skill; a.wantFire = false; }
    }
  } else {
    a.wantFire = false;
    a.wantFireEdge = false;
    a.crouch = false;
    if (b.moveTarget && canFight) followPath(G, a, b.moveTarget, b.moveSpeed, dt);
    else if (b.moveTarget && G.phase === 'roundEnd') { a.vel.x = 0; a.vel.z = 0; }
    else { a.vel.x = 0; a.vel.z = 0; }
  }

  // a frag at a fresh memory, mid-range, now and then
  if (canFight && !vis && b.lastSeen && G.time - b.lastSeenT < 1.2 && a.grenades.frag > 0 && G.time > b.grenadeCd) {
    const d = Math.hypot(b.lastSeen.x - a.pos.x, b.lastSeen.z - a.pos.z);
    if (d > 10 && d < 22 && chance(G.rng, 0.02)) {
      a.yaw = yawToward(a, b.lastSeen.x, b.lastSeen.z);
      a.pitch = 0.3;
      if (throwGrenade(G, a, 'frag')) b.grenadeCd = G.time + 9;
    }
  }

  if (gunOf(a).mag === 0 && !a.reloadEnd) startReload(G, a);
  collideMove(a, dt);
}

export function updateBots(G, dt) {
  for (const a of G.actors) {
    if (!a.bot || !a.alive) continue;
    a.channeling = a.channeling && G.phase !== 'live' && G.phase !== 'planted' ? null : a.channeling;
    const b = a.bot;
    b.thinkT -= dt;
    if (b.thinkT <= 0) {
      b.thinkT = 0.12;
      perceive(G, a);
      if (b.visible && chance(G.rng, 0.3)) b.aimHead = chance(G.rng, 0.4);
      decide(G, a);
    }
    act(G, a, dt);
  }
}
