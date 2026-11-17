// The human Warden: pointer-lock look, WASD movement, firing, grenade
// selection, and the defuse channel. During the buy phase this controller
// deliberately does not touch the number keys — they belong to the shop
// (rounds.js) until the round goes live.

import { input } from './input.js';
import { collideMove } from './physics.js';
import { startReload, throwGrenade } from './weapons.js';

const WALK = 4.6, CROUCH_SPEED = 2.2, AIM_SPEED = 2.7;

export function updateLook(a, dx, dy) {
  a.yaw -= dx * 0.0021;
  a.pitch -= dy * 0.0021;
  a.pitch = Math.max(-1.45, Math.min(1.45, a.pitch));
}

export function updatePlayer(G, a, dt) {
  const edge = input.takeEdge();
  a.channeling = null;
  if (!a.alive) { a.wantFire = false; a.wantFireEdge = false; return; }

  const inBuy = G.phase === 'buy';
  const canFight = G.phase === 'live' || G.phase === 'planted';

  a.crouch = input.keys.has('KeyC') || input.keys.has('ControlLeft');

  // movement, relative to facing
  const f = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
  const s = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
  const sin = Math.sin(a.yaw), cos = Math.cos(a.yaw);
  let mx = (-sin * f + cos * s);
  let mz = (-cos * f - sin * s);
  const ml = Math.hypot(mx, mz);
  if (ml > 0) { mx /= ml; mz /= ml; }
  const speed = a.crouch ? CROUCH_SPEED : (a.aiming ? AIM_SPEED : WALK);
  a.vel.x = mx * speed;
  a.vel.z = mz * speed;
  if (input.wasPressed('Space') && a.grounded && !a.crouch) a.vel.y = 4.6;
  collideMove(a, dt);

  const mySpeed = Math.hypot(a.vel.x, a.vel.z);

  // defuse channel: planted Charge, close, standing still, holding E
  if (G.phase === 'planted' && G.charge.state === 'planted' && input.keys.has('KeyE')) {
    const d = Math.hypot(a.pos.x - G.charge.pos.x, a.pos.z - G.charge.pos.z);
    if (d < 2.3 && mySpeed < 0.6) a.channeling = { kind: 'defuse' };
  }

  a.aiming = canFight && input.rmb && !a.selGrenade;

  // weapon slots and grenades — live phases only, never during buy
  if (!inBuy) {
    if (input.wasPressed('Digit1') && a.weapons.primary) { a.slot = 'primary'; a.selGrenade = null; }
    if (input.wasPressed('Digit2')) { a.slot = 'sidearm'; a.selGrenade = null; }
    if (input.wasPressed('Digit3') && a.grenades.frag > 0) a.selGrenade = 'frag';
    if (input.wasPressed('Digit4') && a.grenades.smoke > 0) a.selGrenade = 'smoke';
    if (input.wasPressed('Digit5') && a.grenades.flash > 0) a.selGrenade = 'flash';
    if (input.wasPressed('KeyR')) startReload(G, a);
  }

  // trigger
  if (canFight && a.selGrenade) {
    a.wantFire = false; a.wantFireEdge = false;
    if (edge) {
      throwGrenade(G, a, a.selGrenade);
      a.selGrenade = null;
    }
  } else if (canFight) {
    a.wantFire = input.mouseDown;
    a.wantFireEdge = edge;
  } else {
    a.wantFire = false;
    a.wantFireEdge = false;
  }
}
