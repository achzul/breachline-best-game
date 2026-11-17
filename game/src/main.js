// Bootstrap and the frame loop. The simulation runs on a fixed 1/60 s
// accumulator so matches are deterministic per seed; rendering, effects,
// sound and the HUD only read the state and drain its event queue.
// Debug handles (window.__game / __actors / __tick) and the ?shot=
// staging exist so the entry can be verified headlessly end to end.

import { createMatch, stepMatch } from './state.js';
import { createView } from './view.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';
import { audio } from './audio.js';
import { input } from './input.js';
import { updateLook } from './player.js';
import { startMatch, TUNE } from './rounds.js';
import { newGun } from './weapons.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 20261117) >>> 0;
const shot = params.get('shot');

const G = createMatch(seed);
const stepN = (n) => { for (let i = 0; i < n; i++) stepMatch(G, 1 / 60); };
window.__game = G;
window.__actors = G.actors;
window.__tick = stepN;

const view = createView(G, document.getElementById('app'));
const fx = createFx(view.scene);
const hud = createHud();
input.init(view.domElement);

let started = false;
function begin() {
  if (started) return;
  started = true;
  G.started = true;
  audio.init();
  startMatch(G);
}

if (params.get('autostart') || (shot && shot !== 'title')) {
  started = true;
  G.started = true;
  startMatch(G);
}

view.domElement.addEventListener('click', () => {
  if (G.phase === 'title') begin();
  else if (G.phase === 'over') startMatch(G);
  if (G.phase !== 'title' && !input.locked) view.domElement.requestPointerLock();
});

// ------------------------------------------------------- screenshot staging
function yawTo(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

if (shot === 'title') {
  setTimeout(() => { window.__shotReady = true; }, 800);
} else if (shot === 'buy') {
  stepN(24);
  G.frozen = true;
  requestAnimationFrame(() => { window.__shotReady = true; });
} else if (shot === 'cover') {
  // play through the buy phase, then stage a firefight at site A: the
  // player holds the entry with a VK-7 while two Jackals cross the site
  stepN(Math.round(TUNE.BUY_T * 60) + 90);
  const p = G.actors[0];
  p.weapons.primary = newGun('vk7');
  p.slot = 'primary';
  p.armor = 100;
  p.hp = 100000; // the camera must survive its own cover shot
  p.pos = { x: -13.5, y: 0, z: -6.5 };
  p.yaw = yawTo(p.pos, { x: -24, z: -2 });
  p.pitch = 0.02;
  G.actors[7].pos = { x: -21, y: 0, z: -4 };
  G.actors[8].pos = { x: -25, y: 0, z: 2 };
  G.actors[1].pos = { x: -15.5, y: 0, z: -9 };
  let chunks = 0;
  const iv = setInterval(() => {
    chunks++;
    p.hp = 100000;
    stepN(20);
    if (chunks >= 5) {
      clearInterval(iv);
      window.__shotReady = true;
    }
  }, 90);
} else if (shot === 'end') {
  // soak a whole match with an unkillable camera, then show the end screen
  (async () => {
    const p = G.actors[0];
    let guard = 0;
    while (G.phase !== 'over' && guard++ < 500) {
      p.hp = 100000;
      stepN(300);
      await new Promise((r) => setTimeout(r, 5));
    }
    p.hp = 100000;
    window.__shotReady = true;
  })();
}

// ------------------------------------------------------------- frame loop
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const m = input.takeMouse();
  const player = G.actors[0];
  if (started && player.alive && G.phase !== 'title' && G.phase !== 'over') {
    updateLook(player, m.x, m.y);
  }

  acc += dt;
  let n = 0;
  while (acc >= 1 / 60 && n < 5) {
    stepMatch(G, 1 / 60);
    acc -= 1 / 60;
    n++;
  }
  if (n === 5) acc = 0;

  const events = G.events.splice(0, G.events.length);
  fx.drain(G, events);
  audio.handle(G, events);
  audio.update(G);
  fx.update(dt, G);
  view.render(dt, fx);
  hud.update(G, events, dt);

  if (G.phase === 'over' && input.wasPressed('KeyR')) startMatch(G);
}
requestAnimationFrame(frame);
