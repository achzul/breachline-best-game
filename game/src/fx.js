// Presentation effects, all driven by the simulation's event queue:
// tracer lines that fade in a blink, impact puffs, muzzle flashes, smoke
// clouds that mirror the simulation's smoke list, explosion flashes and
// camera trauma. Nothing here feeds back into the game.

import * as THREE from 'three';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createFx(scene) {
  const tex = glowTexture();
  let t = 0;

  // --- tracers: one LineSegments, per-vertex colour faded toward black
  // (additive blending makes black invisible)
  const MAXT = 220;
  const tPos = new Float32Array(MAXT * 6);
  const tCol = new Float32Array(MAXT * 6);
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  const lines = new THREE.LineSegments(tGeo, new THREE.LineBasicMaterial({
    vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  lines.frustumCulled = false;
  scene.add(lines);
  const tracerBirth = new Float32Array(MAXT).fill(-9);
  const tracerBase = new Float32Array(MAXT * 3);
  let tracerHead = 0;

  function addTracer(e) {
    const i = tracerHead;
    tracerHead = (tracerHead + 1) % MAXT;
    tPos.set([e.x0, e.y0, e.z0, e.x1, e.y1, e.z1], i * 6);
    const c = new THREE.Color(e.team === 'W' ? 0x8df5e6 : 0xffc37d);
    tracerBase.set([c.r, c.g, c.b], i * 3);
    tracerBirth[i] = t;
    tGeo.attributes.position.needsUpdate = true;
  }

  // --- sprite pool for puffs and flashes
  const pool = [];
  for (let i = 0; i < 40; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    scene.add(s);
    pool.push({ s, born: -9, life: 0.3, from: 0.3, to: 0.6, peak: 0.7 });
  }
  let poolHead = 0;
  function puff(x, y, z, color, from, to, life, peak) {
    const p = pool[poolHead];
    poolHead = (poolHead + 1) % pool.length;
    p.s.position.set(x, y, z);
    p.s.material.color.setHex(color);
    p.born = t; p.life = life; p.from = from; p.to = to; p.peak = peak;
    p.s.visible = true;
  }

  // --- smoke clouds, mirrored from G.smokes by id
  const clouds = new Map();
  function syncSmoke(G) {
    const live = new Set();
    for (const s of G.smokes) {
      live.add(s.id);
      if (!clouds.has(s.id)) {
        const sprites = [];
        for (let i = 0; i < 5; i++) {
          const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color: 0xb9c0c7 });
          const sp = new THREE.Sprite(mat);
          const ang = (i / 5) * Math.PI * 2;
          sp.position.set(s.x + Math.cos(ang) * s.r * 0.45, s.y + (i % 3) * 0.5 - 0.4, s.z + Math.sin(ang) * s.r * 0.45);
          sp.scale.setScalar(s.r * 1.15);
          scene.add(sp);
          sprites.push(sp);
        }
        clouds.set(s.id, { sprites, smoke: s });
      }
    }
    for (const [id, cloud] of clouds) {
      if (!live.has(id)) {
        for (const sp of cloud.sprites) { scene.remove(sp); sp.material.dispose(); }
        clouds.delete(id);
      }
    }
    for (const cloud of clouds.values()) {
      const s = cloud.smoke;
      const age = G.time - s.born;
      const fadeIn = Math.min(1, age / 0.7);
      const fadeOut = Math.min(1, Math.max(0, (s.until - G.time) / 1.6));
      const o = 0.5 * fadeIn * fadeOut;
      cloud.sprites.forEach((sp, i) => {
        sp.material.opacity = o;
        sp.material.rotation = G.time * 0.07 * (i % 2 ? 1 : -1) + i;
      });
    }
  }

  const api = {
    trauma: 0,
    drain(G, events) {
      const player = G.actors[0];
      for (const e of events) {
        if (e.type === 'tracer') addTracer(e);
        else if (e.type === 'impact') puff(e.x, e.y, e.z, 0x9aa0a6, 0.16, 0.5, 0.32, 0.55);
        else if (e.type === 'muzzle' && !(e.actor && e.actor.isPlayer)) puff(e.x, e.y, e.z, 0xffc266, 0.34, 0.5, 0.05, 0.9);
        else if (e.type === 'boom') {
          puff(e.x, e.y + 0.4, e.z, 0xffa040, 1.2, e.big ? 9 : 6, 0.42, 0.95);
          const d = Math.hypot(player.pos.x - e.x, player.pos.z - e.z);
          api.trauma = Math.min(0.7, api.trauma + Math.max(0, 0.55 - d * 0.016));
        } else if (e.type === 'pop') puff(e.x, e.y, e.z, 0xffffff, 0.7, 1.7, 0.16, 0.8);
        else if (e.type === 'smokeBurst') puff(e.x, e.y + 0.5, e.z, 0xb9c0c7, 0.8, 2.6, 0.7, 0.5);
      }
    },
    update(dt, G) {
      t += dt;
      api.trauma = Math.max(0, api.trauma - dt * 1.7);
      for (let i = 0; i < MAXT; i++) {
        const age = t - tracerBirth[i];
        const k = age < 0.09 ? 1 - age / 0.09 : 0;
        tCol[i * 6] = tracerBase[i * 3] * k;
        tCol[i * 6 + 1] = tracerBase[i * 3 + 1] * k;
        tCol[i * 6 + 2] = tracerBase[i * 3 + 2] * k;
        tCol[i * 6 + 3] = tracerBase[i * 3] * k * 0.4;
        tCol[i * 6 + 4] = tracerBase[i * 3 + 1] * k * 0.4;
        tCol[i * 6 + 5] = tracerBase[i * 3 + 2] * k * 0.4;
      }
      tGeo.attributes.color.needsUpdate = true;
      for (const p of pool) {
        if (!p.s.visible) continue;
        const age = t - p.born;
        if (age > p.life) { p.s.visible = false; p.s.material.opacity = 0; continue; }
        const k = age / p.life;
        p.s.scale.setScalar(p.from + (p.to - p.from) * k);
        p.s.material.opacity = p.peak * (1 - k);
      }
      syncSmoke(G);
    },
  };
  return api;
}
