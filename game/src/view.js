// Rendering: the three.js scene, actor bodies, the first-person camera
// and viewmodel. The camera rides the player's eyes with recoil and shake;
// on the title and end screens it pulls back to a slow orbit of the yard.

import * as THREE from 'three';
import { buildScene } from './world.js';
import { buildBody, updateBody, buildGunMesh } from './actors.js';
import { gunOf, WEAPONS } from './weapons.js';

export function createView(G, mount) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const world = buildScene(scene);
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 320);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  for (const a of G.actors) scene.add(buildBody(a));

  // first-person viewmodel, parented to the camera
  const vm = new THREE.Group();
  vm.position.set(0.27, -0.25, -0.55);
  camera.add(vm);
  let vmGun = null, vmFor = null;
  const vmFlash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  vmFlash.position.set(0, 0.02, -0.75);
  vm.add(vmFlash);
  const vmGrenade = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.5 }),
  );
  vmGrenade.position.set(0.05, -0.05, -0.25);
  vmGrenade.visible = false;
  vm.add(vmGrenade);

  let adsT = 0;
  let flashT = 0;

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  function render(dt, fx) {
    const player = G.actors[0];
    for (const a of G.actors) updateBody(G, a, dt);
    world.update(G.time, G.phase === 'planted' ? G.charge.site : null);

    const menuPhase = G.phase === 'title' || G.phase === 'over';
    // never show the player their own body in first person (the camera
    // sits inside it); it reappears for the menu orbit and the death cam
    if (player.body) player.body.group.visible = player.body.group.visible && (menuPhase || !player.alive);
    if (menuPhase || !player.alive) {
      // slow orbit: over the yard on menus, over the body when dead
      const cx = menuPhase ? 0 : player.pos.x;
      const cz = menuPhase ? 0 : player.pos.z;
      const t = G.time * 0.07;
      camera.position.set(cx + Math.sin(t) * 24, 12.5, cz + Math.cos(t) * 19);
      camera.lookAt(cx, 0.5, cz);
      camera.fov = 60;
      camera.updateProjectionMatrix();
      vm.visible = false;
    } else {
      const eyeY = player.pos.y + (player.crouch ? 1.12 : 1.58);
      const shake = fx ? fx.trauma : 0;
      camera.position.set(
        player.pos.x + (Math.random() - 0.5) * shake * 0.14,
        eyeY + (Math.random() - 0.5) * shake * 0.14,
        player.pos.z,
      );
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch + (player.recoil || 0) * 0.014;
      camera.rotation.z = 0;

      const gun = gunOf(player);
      const w = WEAPONS[gun.id];
      const targetFov = player.aiming ? (w.zoom ? 72 / w.zoom : 57) : 72;
      const newFov = camera.fov + (targetFov - camera.fov) * Math.min(1, dt * 11);
      if (Math.abs(newFov - camera.fov) > 0.01) { camera.fov = newFov; camera.updateProjectionMatrix(); }

      vm.visible = true;
      adsT = Math.max(0, Math.min(1, adsT + (player.aiming ? dt * 8 : -dt * 8)));
      const hip = { x: 0.27, y: -0.25, z: -0.55 };
      const ads = { x: 0, y: -0.196, z: -0.42 };
      vm.position.set(
        hip.x + (ads.x - hip.x) * adsT,
        hip.y + (ads.y - hip.y) * adsT + Math.sin(player.walkPhase * 2) * 0.008 * Math.min(1, Math.hypot(player.vel.x, player.vel.z) / 4),
        hip.z + (ads.z - hip.z) * adsT,
      );
      let dip = 0;
      if (player.reloadEnd) {
        const total = w.reload;
        const left = player.reloadEnd - G.time;
        const prog = Math.max(0, Math.min(1, 1 - left / total));
        dip = Math.sin(prog * Math.PI) * 0.5;
      }
      vm.rotation.x = dip;
      vmGrenade.visible = !!player.selGrenade;
      if (vmFor !== gun.id) {
        if (vmGun) vm.remove(vmGun);
        vmGun = buildGunMesh(gun.id);
        vmGun.position.z = -0.1;
        vm.add(vmGun);
        vmFor = gun.id;
      }
      flashT -= dt;
      if (player.wantFire && gun.mag > 0) flashT = 0.045;
      vmFlash.material.opacity = flashT > 0 ? 0.85 : 0;
      vmFlash.rotation.z = Math.random() * Math.PI;
    }

    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, domElement: renderer.domElement, render };
}
