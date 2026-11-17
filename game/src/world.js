// Kestrel Yard: the one map. Plain data first (colliders, sites, spawns,
// waypoint graph) so physics, bots and the minimap all read the same truth,
// then the three.js scene built from that data.
//
// Coordinates are metres: x east, z south, y up. The yard is 76 x 52,
// walled all round. Wardens (defence) spawn south, Jackals (attack) north.
// Site A "Foundry" is west, site B "Silos" east.

import * as THREE from 'three';

// kind drives the scene texture: wall, crate, metal, furnace, silo.
const BOXES = [
  // boundary walls
  [-38, 38, -26, -25, 4, 'wall'], [-38, 38, 25, 26, 4, 'wall'],
  [-38, -37, -26, 26, 4, 'wall'], [37, 38, -26, 26, 4, 'wall'],
  // Foundry (A) structures
  [-30, -25, -8, -3, 3, 'furnace'], [-30, -26, 2, 6, 2.2, 'furnace'],
  [-20, -18, -6, -4, 1.2, 'crate'], [-16, -15, -1, 3, 1.1, 'metal'],
  [-24, -22, 3, 4.2, 1.0, 'metal'],
  // Silos (B) structures
  [25, 29, -4, 0, 3.4, 'silo'], [26, 30, 4, 8, 2.6, 'silo'],
  [19, 21, 5, 7, 1.2, 'crate'], [15, 16, -2, 2, 1.1, 'metal'],
  // mid
  [-8, -6, -10, -2, 2.4, 'wall'], [6, 8, 2, 10, 2.4, 'wall'],
  [-2, 0, -3, -1, 1.2, 'crate'], [0, 2, 3, 5, 1.2, 'crate'],
  [-3, 3, 12, 13.5, 1.6, 'metal'], [-1, 1, -1, 1, 3, 'metal'],
  // lane dividers (gaps at both ends of each)
  [-24, -12, -14, -13, 2, 'wall'], [12, 24, -14, -13, 2, 'wall'],
  [-24, -12, 13, 14, 2, 'wall'], [12, 24, 13, 14, 2, 'wall'],
  // connectors and approach cover
  [-14, -12, -4, -1, 1.8, 'metal'], [12, 14, 1, 4, 1.8, 'metal'],
  [-12, -10, -8, -6, 1.2, 'crate'], [10, 12, 6, 8, 1.2, 'crate'],
  // spawn cover
  [-6, -4, -18, -16, 1.4, 'crate'], [4, 6, -18, -16, 1.4, 'crate'],
  [-6, -4, 16, 18, 1.4, 'crate'], [4, 6, 16, 18, 1.4, 'crate'],
];

export const COLLIDERS = BOXES.map(([x0, x1, z0, z1, h, kind]) => ({ x0, x1, z0, z1, h, kind }));

export const SITES = {
  A: { id: 'A', name: 'Foundry', x: -24, z: -2, r: 6, color: 0xffb454 },
  B: { id: 'B', name: 'Silos', x: 24, z: 2, r: 6, color: 0x4fd8c8 },
};

export const SPAWNS = {
  J: [[-6, -20], [-3, -21], [0, -20], [3, -21], [6, -20]],
  W: [[-6, 20], [-3, 21], [0, 20], [3, 21], [6, 20]],
};

// Where each site's attackers gather before pushing in, and where its
// defenders and post-plant guards stand.
export const SITE_SPOTS = {
  A: {
    entry: { x: -13, z: -2 },
    guards: [{ x: -19, z: -5 }, { x: -27, z: 4 }],
    hold: [{ x: -21, z: -4 }, { x: -26, z: 1 }],
  },
  B: {
    entry: { x: 13, z: 1 },
    guards: [{ x: 23, z: -3 }, { x: 20, z: 6 }],
    hold: [{ x: 21, z: 0 }, { x: 23, z: 6 }],
  },
};

const NODE_XZ = [
  [0, -20], [-10, -17], [10, -17], [-20, -16], [20, -16], [-33, -6], [33, -6],
  [-13, -10], [-14, -2], [-24, -2], [-24, -10], [-24, 7], [-33, 2],
  [0, -8], [-4, 0], [4, 0], [0, 9], [-10, 8], [10, -8],
  [13, 9], [13, 4], [13, -3], [24, 2], [24, -8], [24, 11], [33, 4],
  [0, 20], [-10, 17], [10, 17], [-20, 16], [20, 16], [-29, 10], [29, 10],
];
export const NODES = NODE_XZ.map(([x, z]) => ({ x, z }));

// 2D segment vs the movement-blocking boxes (anything taller than a step).
// Used only for graph building: an edge exists when a walking actor could
// go straight between the two points.
function segmentHitsBox(xa, za, xb, zb, b) {
  const dx = xb - xa, dz = zb - za;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) { if (xa < b.x0 || xa > b.x1) return false; }
  else {
    let ta = (b.x0 - xa) / dx, tb = (b.x1 - xa) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (za < b.z0 || za > b.z1) return false; }
  else {
    let ta = (b.z0 - za) / dz, tb = (b.z1 - za) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export function walkClear(xa, za, xb, zb) {
  for (const b of COLLIDERS) {
    if (b.h <= 0.55) continue;
    if (segmentHitsBox(xa, za, xb, zb, b)) return false;
  }
  return true;
}

// Adjacency, built once: nodes within 16 m with a clear walk line.
const ADJ = NODES.map(() => []);
for (let i = 0; i < NODES.length; i++) {
  for (let j = i + 1; j < NODES.length; j++) {
    const a = NODES[i], b = NODES[j];
    if (Math.hypot(a.x - b.x, a.z - b.z) <= 16 && walkClear(a.x, a.z, b.x, b.z)) {
      ADJ[i].push(j); ADJ[j].push(i);
    }
  }
}

// Breadth-first path from a point to a point through the graph. Returns a
// list of waypoints (graph nodes, then the destination), or just the
// destination when the straight walk is clear.
export function findPath(from, to) {
  if (walkClear(from.x, from.z, to.x, to.z)) return [{ x: to.x, z: to.z }];
  const startLinks = [], goalLinks = [];
  for (let i = 0; i < NODES.length; i++) {
    const n = NODES[i];
    if (Math.hypot(n.x - from.x, n.z - from.z) <= 17 && walkClear(from.x, from.z, n.x, n.z)) startLinks.push(i);
    if (Math.hypot(n.x - to.x, n.z - to.z) <= 17 && walkClear(n.x, n.z, to.x, to.z)) goalLinks.push(i);
  }
  const goalSet = new Set(goalLinks);
  const prev = new Map();
  const queue = [];
  for (const s of startLinks) { prev.set(s, -1); queue.push(s); }
  let found = -1;
  while (queue.length) {
    const cur = queue.shift();
    if (goalSet.has(cur)) { found = cur; break; }
    for (const nb of ADJ[cur]) {
      if (!prev.has(nb)) { prev.set(nb, cur); queue.push(nb); }
    }
  }
  if (found === -1) return [{ x: to.x, z: to.z }];
  const chain = [];
  for (let c = found; c !== -1; c = prev.get(c)) chain.push(NODES[c]);
  chain.reverse();
  chain.push({ x: to.x, z: to.z });
  return chain;
}

export function nearestNode(pos) {
  let best = NODES[0], bd = Infinity;
  for (const n of NODES) {
    const d = (n.x - pos.x) ** 2 + (n.z - pos.z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

// ---------------------------------------------------------------- scene ---

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function groundTexture() {
  return canvasTexture(1024, 704, (g, w, h) => {
    g.fillStyle = '#585d61'; g.fillRect(0, 0, w, h);
    // concrete speckle
    for (let i = 0; i < 5200; i++) {
      const v = 70 + Math.random() * 40;
      g.fillStyle = `rgba(${v},${v},${v + 6},0.25)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // lane wear
    g.fillStyle = 'rgba(40,42,46,0.35)';
    g.fillRect(0, h * 0.44, w, h * 0.12);
    g.fillRect(w * 0.44, 0, w * 0.12, h);
    const px = (x) => ((x + 38) / 76) * w, pz = (z) => ((z + 26) / 52) * h, pr = (r) => (r / 76) * w;
    for (const s of [SITES.A, SITES.B]) {
      g.strokeStyle = s.id === 'A' ? '#ffb454' : '#4fd8c8';
      g.lineWidth = 7;
      g.beginPath(); g.arc(px(s.x), pz(s.z), pr(s.r), 0, Math.PI * 2); g.stroke();
      g.fillStyle = s.id === 'A' ? 'rgba(255,180,84,0.9)' : 'rgba(79,216,200,0.9)';
      g.font = `bold ${Math.round(pr(3.4))}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s.id, px(s.x), pz(s.z) - pr(0.4));
      g.font = `bold ${Math.round(pr(1.5))}px system-ui, sans-serif`;
      g.fillText(s.name.toUpperCase(), px(s.x), pz(s.z) + pr(2.6));
    }
    g.fillStyle = 'rgba(230,235,240,0.5)';
    g.font = `bold ${Math.round(pr(2.2))}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillText('KESTREL YARD', px(0), pz(-19));
  });
}

function kindTexture(kind) {
  const draws = {
    wall: (g, w, h) => {
      g.fillStyle = '#6d7176'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < 300; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 2);
      g.strokeStyle = 'rgba(30,30,34,0.5)'; g.lineWidth = 3;
      g.strokeRect(4, 4, w - 8, h - 8);
    },
    crate: (g, w, h) => {
      g.fillStyle = '#8a6b42'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#5f4726'; g.lineWidth = 10;
      g.strokeRect(5, 5, w - 10, h - 10);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
      g.fillStyle = 'rgba(255,230,180,0.16)'; g.fillRect(0, 0, w, 10);
    },
    metal: (g, w, h) => {
      g.fillStyle = '#5d6771'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(20,24,28,0.6)'; g.lineWidth = 3;
      for (let x = 32; x < w; x += 42) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, w, 8);
      g.fillStyle = '#39424b';
      for (const [x, y] of [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12]]) {
        g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
      }
    },
    furnace: (g, w, h) => {
      g.fillStyle = '#3f4249'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2c2e33'; g.fillRect(0, h * 0.55, w, h * 0.45);
      g.fillStyle = '#ff7a2a';
      for (let x = 14; x < w - 10; x += 30) g.fillRect(x, h * 0.62, 16, h * 0.2);
      g.fillStyle = 'rgba(255,150,60,0.25)';
      for (let x = 14; x < w - 10; x += 30) g.fillRect(x - 3, h * 0.62 - 3, 22, h * 0.2 + 6);
    },
    silo: (g, w, h) => {
      g.fillStyle = '#99a3ab'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(60,70,78,0.55)';
      g.fillRect(0, h * 0.3, w, 7); g.fillRect(0, h * 0.62, w, 7);
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(0, 0, 12, h);
    },
  };
  return canvasTexture(256, 256, draws[kind] ?? draws.wall);
}

export function buildScene(scene) {
  scene.background = new THREE.Color(0x11181f);
  scene.fog = new THREE.Fog(0x11181f, 34, 105);
  scene.add(new THREE.HemisphereLight(0xcfe0ee, 0x33291d, 1.05));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.0);
  sun.position.set(28, 42, 12);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(76, 52),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const mats = {};
  for (const kind of ['wall', 'crate', 'metal', 'furnace', 'silo']) {
    mats[kind] = new THREE.MeshStandardMaterial({ map: kindTexture(kind), roughness: 0.85, metalness: 0.08 });
  }
  for (const b of COLLIDERS) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, b.h, b.z1 - b.z0), mats[b.kind]);
    m.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2);
    scene.add(m);
  }

  // Site rings and plant pads.
  const rings = {};
  for (const s of [SITES.A, SITES.B]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.4, s.r, 40),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    scene.add(ring);
    rings[s.id] = ring;
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.12, 20),
      new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.4 }),
    );
    pad.position.set(s.x, 0.06, s.z);
    scene.add(pad);
  }

  // Skyline silhouettes beyond the walls.
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x0b1016 });
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2 + 0.2;
    const dist = 52 + (i % 4) * 7;
    const hgt = 9 + ((i * 7) % 15);
    const b = new THREE.Mesh(new THREE.BoxGeometry(9, hgt, 9), skyMat);
    b.position.set(Math.cos(ang) * dist, hgt / 2 - 1, Math.sin(ang) * dist * 0.72);
    scene.add(b);
  }

  return {
    update(t, plantedSiteId) {
      for (const s of [SITES.A, SITES.B]) {
        const ring = rings[s.id];
        if (plantedSiteId === s.id) {
          ring.material.color.setHex(0xff4444);
          ring.material.opacity = 0.45 + 0.4 * Math.abs(Math.sin(t * 6));
        } else {
          ring.material.color.setHex(s.color);
          ring.material.opacity = 0.45 + 0.12 * Math.sin(t * 1.6);
        }
      }
    },
  };
}
