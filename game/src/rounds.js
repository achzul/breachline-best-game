// The round machine: buy phase -> live -> planted -> round end, first to
// seven. Owns the phase timer, the plant and defuse channels, Charge
// pickup, the shop (for the player; bots shop themselves in bots.js) and
// the economy payouts.

import { SITES, SPAWNS } from './world.js';
import { SHOP, newGun, GRENADE_CAPS } from './weapons.js';
import { assignPlans, shopAll } from './bots.js';
import { input } from './input.js';

export const TUNE = { BUY_T: 12, LIVE_T: 100, FUSE_T: 40, PLANT_T: 2.8, DEFUSE_T: 5, END_T: 4.5, WIN: 7 };

const REASON_TEXT = {
  elimination: 'Enemy team eliminated',
  defused: 'Charge defused',
  detonation: 'Charge detonated',
  time: 'Time expired — the site held',
};

export function placeActors(G) {
  const byTeam = { W: 0, J: 0 };
  for (const a of G.actors) {
    const i = byTeam[a.team]++;
    const [sx, sz] = SPAWNS[a.team][i % SPAWNS[a.team].length];
    a.pos = { x: sx, y: 0, z: sz };
    a.vel = { x: 0, y: 0, z: 0 };
    a.yaw = a.team === 'W' ? 0 : Math.PI;
    a.pitch = 0;
    a.alive = true;
    a.hp = 100;
    a.deathT = 0;
    a.channeling = null;
    a.blindUntil = 0;
    a.bloom = 0;
    a.reloadEnd = 0;
    a.wantFire = false;
    a.wantFireEdge = false;
    a.selGrenade = null;
    if (a.diedLastRound) {
      a.weapons.primary = null;
      a.slot = 'sidearm';
      a.weapons.sidearm = newGun('wasp');
      a.armor = 0;
      a.grenades = { frag: 0, smoke: 0, flash: 0 };
      a.diedLastRound = false;
    }
  }
}

export function startMatch(G) {
  G.score = { W: 0, J: 0 };
  G.round = 0;
  G.lossStreak = { W: 0, J: 0 };
  G.winner = null;
  for (const a of G.actors) {
    a.money = 800;
    a.kills = 0;
    a.deaths = 0;
    a.shotsFired = 0;
    a.diedLastRound = true; // full loadout reset through placeActors
  }
  startRound(G);
}

export function startRound(G) {
  G.round++;
  G.roundStartT = G.time;
  G.deathsThisRound = 0;
  G.deathsBase = G.actors.reduce((s, a) => s + a.deaths, 0);
  G.plantedEver = false;
  G.smokes = [];
  G.grenades = [];
  G.noise = [];
  G.killfeed = [];
  G.charge = { state: 'carried', carrier: null, pos: { x: 0, z: 0 }, channel: 0, defuse: 0, site: null };
  placeActors(G);
  assignPlans(G);
  shopAll(G);
  G.phase = 'buy';
  G.phaseT = TUNE.BUY_T;
  G.events.push({ type: 'banner', text: `ROUND ${G.round}`, sub: 'Buy phase', ms: 1600 });
}

export function buyItem(G, a, entry) {
  if (a.money < entry.price) return false;
  if (entry.slot === 'armor') {
    if (a.armor > 0) return false;
    a.armor = 100;
  } else if (entry.slot === 'primary') {
    if (a.weapons.primary && a.weapons.primary.id === entry.id) return false;
    a.weapons.primary = newGun(entry.id);
    a.slot = 'primary';
  } else if (entry.slot === 'grenade') {
    if (a.grenades[entry.id] >= GRENADE_CAPS[entry.id]) return false;
    a.grenades[entry.id]++;
  }
  a.money -= entry.price;
  G.events.push({ type: 'buy', actor: a, label: entry.label });
  return true;
}

function processBuy(G) {
  const player = G.actors[0];
  if (!player.alive) return;
  for (const entry of SHOP) {
    if (input.wasPressed(entry.key)) buyItem(G, player, entry);
  }
}

function updatePlant(G, dt) {
  const c = G.charge;
  if (c.state !== 'carried') { c.channel = 0; return; }
  const carrier = c.carrier;
  if (carrier && carrier.alive && carrier.channeling && carrier.channeling.kind === 'plant') {
    c.channel += dt;
    if (c.channel >= TUNE.PLANT_T) {
      c.state = 'planted';
      c.pos = { x: carrier.pos.x, z: carrier.pos.z };
      c.site = Math.hypot(c.pos.x - SITES.A.x, c.pos.z - SITES.A.z) < Math.hypot(c.pos.x - SITES.B.x, c.pos.z - SITES.B.z) ? 'A' : 'B';
      carrier.money += 300;
      carrier.channeling = null;
      G.plantedEver = true;
      G.phase = 'planted';
      G.phaseT = TUNE.FUSE_T;
      G.events.push({ type: 'planted', site: c.site });
      G.events.push({ type: 'banner', text: 'CHARGE PLANTED', sub: `Site ${c.site} — defuse it`, ms: 2000 });
    }
  } else {
    c.channel = Math.max(0, c.channel - dt * 1.5);
  }
}

function updatePickup(G) {
  const c = G.charge;
  if (c.state !== 'dropped') return;
  for (const a of G.actors) {
    if (a.team !== 'J' || !a.alive) continue;
    if (Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z) < 1.7) {
      c.state = 'carried';
      c.carrier = a;
      // the recovered Charge comes with the plan attached: this bot is the
      // carrier now and heads for the site its team chose
      const site = a.bot && a.bot.plan ? a.bot.plan.site : SITES.A;
      if (a.bot) { a.bot.role = 'carrier'; a.bot.plan = { site, stage: 1 }; a.bot.path = []; a.bot.pathTarget = null; }
      G.events.push({ type: 'banner', text: 'CHARGE RECOVERED', sub: '', ms: 1200 });
      return;
    }
  }
}

function endRound(G, winner, reason) {
  if (G.phase === 'roundEnd' || G.phase === 'over') return;
  G.score[winner]++;
  const loser = winner === 'W' ? 'J' : 'W';
  const bonus = Math.min(1000 + 200 * G.lossStreak[loser], 1800);
  for (const a of G.actors) {
    if (a.team === winner) a.money += 1400;
    else a.money += bonus;
    if (G.plantedEver && a.team === 'J') a.money += 800;
    if (!a.alive) a.diedLastRound = true;
  }
  G.lossStreak[winner] = 0;
  G.lossStreak[loser]++;
  G.phase = 'roundEnd';
  G.phaseT = TUNE.END_T;
  G.events.push({
    type: 'banner',
    text: winner === 'W' ? 'WARDENS TAKE THE ROUND' : 'JACKALS TAKE THE ROUND',
    sub: REASON_TEXT[reason] || '', ms: 2600,
  });
  G.events.push({ type: 'roundEnd', winner, reason });
}

function aliveCount(G, team) {
  return G.actors.reduce((n, a) => n + (a.alive && a.team === team ? 1 : 0), 0);
}

export function updateRounds(G, dt) {
  if (G.phase === 'buy') {
    processBuy(G);
    if (G.phaseT <= 0) {
      G.phase = 'live';
      G.phaseT = TUNE.LIVE_T;
      G.events.push({ type: 'banner', text: 'GO', sub: '', ms: 700 });
    }
    return;
  }
  if (G.phase === 'live') {
    updatePlant(G, dt);
    updatePickup(G);
    if (G.phase !== 'live') return; // planting flipped the phase
    if (aliveCount(G, 'W') === 0) return endRound(G, 'J', 'elimination');
    if (aliveCount(G, 'J') === 0) return endRound(G, 'W', 'elimination');
    if (G.phaseT <= 0) return endRound(G, 'W', 'time');
    return;
  }
  if (G.phase === 'planted') {
    const c = G.charge;
    const defuser = G.actors.find((a) => a.team === 'W' && a.alive && a.channeling && a.channeling.kind === 'defuse');
    if (defuser) {
      c.defuse += dt;
      if (c.defuse >= TUNE.DEFUSE_T) {
        c.state = 'defused';
        G.events.push({ type: 'banner', text: 'CHARGE DEFUSED', sub: '', ms: 2000 });
        return endRound(G, 'W', 'defused');
      }
    } else {
      c.defuse = Math.max(0, c.defuse - dt * 2);
    }
    if (aliveCount(G, 'W') === 0) return endRound(G, 'J', 'elimination');
    if (G.phaseT <= 0) {
      G.events.push({ type: 'boom', x: c.pos.x, y: 1, z: c.pos.z, big: true });
      c.state = 'detonated';
      return endRound(G, 'J', 'detonation');
    }
    return;
  }
  if (G.phase === 'roundEnd') {
    if (G.phaseT <= 0) {
      if (G.score.W >= TUNE.WIN || G.score.J >= TUNE.WIN) {
        G.phase = 'over';
        G.winner = G.score.W >= TUNE.WIN ? 'W' : 'J';
        G.events.push({ type: 'matchEnd', winner: G.winner });
      } else {
        startRound(G);
      }
    }
  }
}
