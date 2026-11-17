// Match state and the fixed-step simulation. One step (1/60 s) advances
// the player, the bots, weapons and grenades, then the round machine —
// rendering and sound only read what the step produced, and presentation
// effects drain the per-step event queue.

import { COLLIDERS } from './world.js';
import { makeActor } from './actors.js';
import { makeBot, updateBots } from './bots.js';
import { mulberry32 } from './rng.js';
import { updatePlayer } from './player.js';
import { serviceWeapon, tryFire, updateGrenades } from './weapons.js';
import { updateRounds, placeActors } from './rounds.js';

const WARDEN_NAMES = ['Vex', 'Ondo', 'Pell', 'Rusk'];
const JACKAL_NAMES = ['Mara', 'Ilya', 'Sable', 'Kord', 'Fen'];

export function createMatch(seed) {
  const rng = mulberry32(seed);
  const actors = [makeActor(0, 'W', true, 'YOU')];
  WARDEN_NAMES.forEach((name, i) => {
    const a = makeActor(i + 1, 'W', false, name);
    a.bot = makeBot(rng);
    actors.push(a);
  });
  JACKAL_NAMES.forEach((name, i) => {
    const a = makeActor(i + 5, 'J', false, name);
    a.bot = makeBot(rng);
    actors.push(a);
  });
  const G = {
    seed, rng, time: 0,
    phase: 'title', phaseT: 0, round: 0, roundStartT: 0,
    score: { W: 0, J: 0 }, lossStreak: { W: 0, J: 0 }, winner: null, siteStreak: null,
    actors,
    charge: { state: 'carried', carrier: null, pos: { x: 0, z: 0 }, channel: 0, defuse: 0, site: null },
    smokes: [], grenades: [], noise: [], events: [], killfeed: [],
    plantedEver: false, deathsThisRound: 0, deathsBase: 0,
    started: false, frozen: false,
    collidersCache: COLLIDERS,
  };
  placeActors(G);
  return G;
}

export function stepMatch(G, dt) {
  if (G.frozen) return;
  G.time += dt;
  if (G.phase === 'title' || G.phase === 'over') return;
  G.phaseT -= dt;

  const player = G.actors[0];
  if (player.alive) updatePlayer(G, player, dt);
  else { player.wantFire = false; player.wantFireEdge = false; }

  updateBots(G, dt);

  for (const a of G.actors) {
    serviceWeapon(G, a);
    if (a.alive && (a.wantFire || a.wantFireEdge)) tryFire(G, a);
    a.recoil = Math.max(0, (a.recoil || 0) - dt * 5);
  }

  updateGrenades(G, dt);

  if (G.noise.length > 40) G.noise = G.noise.filter((n) => G.time - n.t < 3);
  G.deathsThisRound = G.actors.reduce((s, a) => s + a.deaths, 0) - G.deathsBase;

  updateRounds(G, dt);
}
