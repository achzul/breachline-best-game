// Actors: the plain simulation record for a fighter, and the procedural
// low-poly body that presents it — boxes for torso, limbs and gun, animated
// by walk cycle, crouch and death fall. No model files, no textures to load.

import * as THREE from 'three';
import { newGun, gunOf } from './weapons.js';

export function makeActor(id, team, isPlayer, name) {
  return {
    id, team, isPlayer, name,
    alive: true, hp: 100, armor: 0,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    yaw: team === 'W' ? Math.PI : 0, pitch: 0,
    crouch: false, grounded: true, radius: 0.42,
    money: 800, kills: 0, deaths: 0, shotsFired: 0,
    weapons: { primary: null, sidearm: newGun('wasp') },
    slot: 'sidearm', selGrenade: null,
    grenades: { frag: 0, smoke: 0, flash: 0 },
    wantFire: false, wantFireEdge: false, aiming: false,
    nextShotAt: 0, reloadEnd: 0, bloom: 0, recoil: 0,
    channeling: null, blindUntil: 0, lastAttacker: null,
    walkPhase: 0, deathT: 0, bot: null, body: null,
  };
}

const TEAM_STYLE = {
  W: { torso: 0x1f8a80, legs: 0x274b4a, helmet: 0x14524c, vest: 0x123c38 },
  J: { torso: 0xc07f24, legs: 0x54432a, helmet: 0x7a5316, vest: 0x4a3512 },
};

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05 }),
  );
  m.position.set(x, y, z);
  return m;
}

// A gun built from boxes, sized by class; shared by the third-person
// bodies and the first-person viewmodel.
export function buildGunMesh(id) {
  const g = new THREE.Group();
  const dark = 0x22262b, mid = 0x394048;
  if (id === 'wasp') {
    g.add(box(0.07, 0.15, 0.3, dark, 0, 0, -0.08));
    g.add(box(0.06, 0.12, 0.1, mid, 0, -0.12, 0.02));
  } else if (id === 'raptor') {
    g.add(box(0.08, 0.18, 0.52, dark, 0, 0, -0.14));
    g.add(box(0.06, 0.2, 0.09, mid, 0, -0.17, -0.05));
    g.add(box(0.05, 0.05, 0.2, mid, 0, 0.1, -0.42));
  } else if (id === 'mule') {
    g.add(box(0.09, 0.17, 0.74, dark, 0, 0, -0.2));
    g.add(box(0.07, 0.07, 0.4, 0x6b4e2a, 0, -0.1, -0.3));
    g.add(box(0.08, 0.12, 0.16, mid, 0, -0.05, 0.14));
  } else if (id === 'longbow') {
    g.add(box(0.08, 0.19, 0.92, dark, 0, 0, -0.26));
    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10),
      new THREE.MeshStandardMaterial({ color: mid, roughness: 0.5 }),
    );
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.15, -0.2);
    g.add(scope);
    g.add(box(0.06, 0.18, 0.09, mid, 0, -0.16, -0.02));
  } else { // vk7
    g.add(box(0.08, 0.2, 0.66, dark, 0, 0, -0.18));
    g.add(box(0.06, 0.2, 0.09, mid, 0, -0.17, -0.04));
    g.add(box(0.04, 0.09, 0.04, 0xb03030, 0, 0.14, -0.3));
    g.add(box(0.07, 0.1, 0.2, mid, 0, -0.04, 0.2));
  }
  return g;
}

export function buildBody(actor) {
  const st = TEAM_STYLE[actor.team];
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);

  const legGeo = new THREE.BoxGeometry(0.17, 0.95, 0.19);
  legGeo.translate(0, -0.475, 0);
  const legMat = new THREE.MeshStandardMaterial({ color: st.legs, roughness: 0.85 });
  const legL = new THREE.Mesh(legGeo, legMat); legL.position.set(-0.14, 0.95, 0);
  const legR = new THREE.Mesh(legGeo, legMat); legR.position.set(0.14, 0.95, 0);
  inner.add(legL, legR);

  const torso = box(0.54, 0.66, 0.3, st.torso, 0, 1.28, 0);
  inner.add(torso);
  const vest = box(0.58, 0.52, 0.37, st.vest, 0, 1.28, 0);
  inner.add(vest);

  const head = new THREE.Group();
  head.position.set(0, 1.72, 0);
  head.add(box(0.26, 0.28, 0.26, 0xc9a189, 0, 0, 0));
  head.add(box(0.3, 0.13, 0.3, st.helmet, 0, 0.15, 0));
  head.add(box(0.28, 0.07, 0.1, st.helmet, 0, 0.02, -0.15));
  inner.add(head);

  const armGeo = new THREE.BoxGeometry(0.13, 0.55, 0.13);
  armGeo.translate(0, -0.24, 0);
  const armMat = new THREE.MeshStandardMaterial({ color: st.torso, roughness: 0.85 });
  const armL = new THREE.Mesh(armGeo, armMat);
  armL.position.set(-0.34, 1.54, 0);
  armL.rotation.x = -0.7;
  armL.rotation.z = 0.25;
  inner.add(armL);
  const armR = new THREE.Mesh(armGeo, armMat);
  armR.position.set(0.34, 1.54, 0);
  armR.rotation.x = -1.35;
  inner.add(armR);

  const gunMount = new THREE.Group();
  gunMount.position.set(0.3, 1.44, -0.3);
  inner.add(gunMount);

  // The Charge rides on the carrier's back: a dark case with a live light.
  const chargeProp = new THREE.Group();
  chargeProp.position.set(0, 1.3, 0.26);
  chargeProp.add(box(0.36, 0.46, 0.15, 0x1c1f24, 0, 0, 0));
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3333 }),
  );
  lamp.position.set(0, 0.14, 0.09);
  chargeProp.add(lamp);
  chargeProp.visible = false;
  inner.add(chargeProp);

  actor.body = { group, inner, legL, legR, armR, head, vest, gunMount, gun: null, gunFor: null, chargeProp, lamp };
  return group;
}

export function updateBody(G, a, dt) {
  const b = a.body;
  if (!b) return;
  const speed = Math.hypot(a.vel.x, a.vel.z);
  if (a.alive) a.walkPhase += dt * (2.2 + speed * 1.6) * (speed > 0.2 ? 1 : 0);
  const swing = a.alive ? Math.sin(a.walkPhase * 2) * 0.5 * Math.min(1, speed / 4) : 0;
  b.legL.rotation.x = swing;
  b.legR.rotation.x = -swing;
  b.armR.rotation.x = -1.35 + Math.sin(a.walkPhase * 2) * 0.12 * Math.min(1, speed / 4);
  b.group.position.set(a.pos.x, a.pos.y, a.pos.z);
  b.group.rotation.y = a.yaw;
  b.inner.scale.y = a.crouch && a.alive ? 0.8 : 1;
  b.inner.position.y = a.crouch && a.alive ? -0.12 : 0;
  b.vest.visible = a.armor > 0;
  b.chargeProp.visible = G.charge.carrier === a && a.alive;
  if (b.chargeProp.visible) b.lamp.material.color.setHex(Math.sin(G.time * 7) > 0 ? 0xff3333 : 0x661111);
  // death: tip over backwards and settle
  if (!a.alive) {
    a.deathT += dt;
    const k = Math.min(1, a.deathT * 2.4);
    b.group.rotation.x = -Math.PI / 2 * k * 0.92;
    b.group.position.y = a.pos.y + 0.12 * k;
  } else {
    b.group.rotation.x = 0;
  }
  b.group.visible = a.alive || a.deathT < 4;
  // swap the held gun mesh when the equipped weapon changes
  const gid = gunOf(a).id;
  if (b.gunFor !== gid) {
    if (b.gun) b.gunMount.remove(b.gun);
    b.gun = buildGunMesh(gid);
    b.gunMount.add(b.gun);
    b.gunFor = gid;
  }
}
