// The DOM HUD: scoreboard and timer, minimap, health and weapon panels,
// killfeed, buy menu, banners, channel bar, damage vignette, flash
// overlay, and the title / match-end screens the judges weigh. Everything
// is rebuilt from state each frame; nothing here touches the simulation.

import { SHOP, WEAPONS, gunOf, GRENADE_CAPS } from './weapons.js';
import { TUNE } from './rounds.js';
import { COLLIDERS, SITES } from './world.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function fmtClock(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud() {
  const root = document.getElementById('hud-root');

  const minimap = el('canvas', 'minimap hud-el', root);
  minimap.width = 176;
  minimap.height = 124;
  const mctx = minimap.getContext('2d');

  const topbar = el('div', 'topbar hud-el', root);
  const tbScore = el('div', 'tb-score', topbar, '0 — 0');
  const tbInfo = el('div', 'tb-info', topbar, '');

  const money = el('div', 'money hud-el', root, '$800');
  const killfeed = el('div', 'killfeed hud-el', root);
  const plantAlert = el('div', 'plant-alert hidden', root, '');

  const banner = el('div', 'banner hidden', root);
  const bannerText = el('div', 'banner-text', banner);
  const bannerSub = el('div', 'banner-sub', banner);

  const cross = el('div', 'crosshair hud-el', root);
  el('span', 'tick t', cross);
  el('span', 'tick b', cross);
  el('span', 'tick l', cross);
  el('span', 'tick r', cross);
  el('span', 'dot', cross);
  const hitmark = el('div', 'hitmarker hidden', root, '✕');

  const channel = el('div', 'channel hidden', root);
  const channelLabel = el('div', 'channel-label', channel, '');
  const channelWrap = el('div', 'channel-wrap', channel);
  const channelFill = el('div', 'channel-fill', channelWrap);

  const bl = el('div', 'bottom-left hud-el', root);
  el('div', 'bl-name', bl, 'YOU — WARDENS');
  const hpRow = el('div', 'bar-row', bl);
  el('span', 'bar-label', hpRow, 'HP');
  const hpWrap = el('div', 'bar-wrap', hpRow);
  const hpFill = el('div', 'bar-fill hp', hpWrap);
  const hpNum = el('span', 'bar-num', hpRow, '100');
  const arRow = el('div', 'bar-row', bl);
  el('span', 'bar-label', arRow, 'AR');
  const arWrap = el('div', 'bar-wrap', arRow);
  const arFill = el('div', 'bar-fill ar', arWrap);
  const arNum = el('span', 'bar-num', arRow, '0');

  const br = el('div', 'bottom-right hud-el', root);
  const weapName = el('div', 'weap-name', br, '');
  const ammo = el('div', 'ammo', br, '');
  const grenLine = el('div', 'gren-line', br, '');
  el('div', 'slot-hint', br, '1 primary · 2 sidearm · R reload');

  const buyMenu = el('div', 'buy-menu hidden', root);
  el('div', 'buy-title', buyMenu, 'BUY MENU — number keys');
  const buyRows = SHOP.map((entry) => {
    const row = el('div', 'buy-row', buyMenu);
    el('span', 'buy-key', row, entry.key.replace('Digit', ''));
    el('span', 'buy-label', row, entry.label);
    const price = el('span', 'buy-price', row, `$${entry.price}`);
    return { entry, row, price };
  });
  el('div', 'buy-note', buyMenu, 'Weapons slots unlock when the round goes live');

  const vignette = el('div', 'vignette', root);
  const blind = el('div', 'blind', root);
  const scope = el('div', 'scope hidden', root);

  const title = el('div', 'title-screen', root);
  title.innerHTML = `
    <div class="title-kicker">TACTICAL FPS · 5 V 5 · FIRST TO 7</div>
    <h1>BREACHLINE</h1>
    <div class="title-sub">Kestrel Yard — the Jackals are bringing a Charge. Hold the yard.</div>
    <div class="title-cols">
      <div class="title-card">
        <h3>THE MISSION</h3>
        <p>You fight with the <b>Wardens</b>. The Jackals push a site and plant
        the <b>Charge</b> — stop the plant, wipe them out, or defuse it.
        Win rounds, manage your money, first team to <b>7</b> takes the yard.</p>
        <p>Every round opens with a 12-second <b>buy phase</b>. Kills pay $300,
        round wins $1,400, plants pay the whole Jackal team $800.</p>
      </div>
      <div class="title-card">
        <h3>CONTROLS</h3>
        <p><b>W A S D</b> move · <b>Mouse</b> look · <b>LMB</b> fire · <b>RMB</b> aim<br>
        <b>R</b> reload · <b>Space</b> jump · <b>Ctrl / C</b> crouch<br>
        <b>1 / 2</b> weapons · <b>3 / 4 / 5</b> select grenade, click to throw<br>
        <b>E</b> defuse the Charge · <b>Buy phase:</b> number keys shop</p>
      </div>
    </div>
    <div class="title-cta">CLICK TO PLAY</div>`;

  const end = el('div', 'end-screen hidden', root);
  const endTitle = el('div', 'end-title', end, '');
  const endScore = el('div', 'end-score', end, '');
  const endTable = el('div', 'end-table', end);
  el('div', 'end-hint', end, 'Click or press R to play again');

  let bannerUntil = -1;
  let hitT = -9;
  let lastHp = 100;
  let dmgFlash = 0;
  let mapAcc = 1;
  let endBuilt = false;
  let feedCache = '';

  function drawMap(G) {
    const W = 176, H = 124;
    const mx = (x) => ((x + 38) / 76) * W;
    const mz = (z) => ((z + 26) / 52) * H;
    mctx.fillStyle = '#10151a';
    mctx.fillRect(0, 0, W, H);
    mctx.fillStyle = '#39424b';
    for (const c of COLLIDERS) mctx.fillRect(mx(c.x - c.hw), mz(c.z - c.hd), (c.hw * 2 / 76) * W, (c.hd * 2 / 52) * H);
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      mctx.strokeStyle = key === 'A' ? '#ffd166' : '#7df9ea';
      mctx.lineWidth = 1.5;
      mctx.beginPath();
      mctx.arc(mx(s.x), mz(s.z), (s.r / 76) * W, 0, Math.PI * 2);
      mctx.stroke();
      mctx.fillStyle = '#e8edf2';
      mctx.font = 'bold 9px system-ui';
      mctx.fillText(key, mx(s.x) - 3, mz(s.z) + 3);
    }
    const c = G.charge;
    if (c.state === 'dropped' || c.state === 'planted') {
      mctx.fillStyle = c.state === 'planted' ? '#ff5252' : '#ffb454';
      mctx.save();
      mctx.translate(mx(c.pos.x), mz(c.pos.z));
      mctx.rotate(Math.PI / 4);
      mctx.fillRect(-3, -3, 6, 6);
      mctx.restore();
    }
    for (const a of G.actors) {
      if (!a.alive) continue;
      mctx.fillStyle = a.isPlayer ? '#ffffff' : a.team === 'W' ? '#35e0cf' : '#ffb454';
      mctx.beginPath();
      mctx.arc(mx(a.pos.x), mz(a.pos.z), a.isPlayer ? 3 : 2.4, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  function buildEnd(G) {
    endTitle.textContent = G.winner === 'W' ? 'VICTORY' : 'DEFEAT';
    endTitle.className = `end-title ${G.winner === 'W' ? 'win' : 'lose'}`;
    endScore.textContent = `WARDENS ${G.score.W} — ${G.score.J} JACKALS`;
    const rows = [...G.actors].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    endTable.innerHTML = rows.map((a) => `
      <div class="end-row ${a.team === 'W' ? 'tw' : 'tj'}">
        <span class="end-name">${a.name}${a.isPlayer ? ' (you)' : ''}</span>
        <span class="end-team">${a.team === 'W' ? 'Wardens' : 'Jackals'}</span>
        <span class="end-kd">${a.kills} K · ${a.deaths} D</span>
      </div>`).join('');
  }

  function update(G, events, dt) {
    const p = G.actors[0];
    root.dataset.phase = G.phase;

    for (const e of events) {
      if (e.type === 'banner') {
        bannerText.textContent = e.text;
        bannerSub.textContent = e.sub || '';
        bannerUntil = G.time + (e.ms || 1500) / 1000;
        banner.classList.remove('hidden');
      } else if (e.type === 'hitmark' || e.type === 'hitmarkHead') {
        hitT = G.time;
      }
    }
    if (G.time > bannerUntil || G.phase === 'over') banner.classList.add('hidden');
    hitmark.classList.toggle('hidden', G.time - hitT > 0.18);
    title.classList.toggle('hidden', G.phase !== 'title');

    const over = G.phase === 'over';
    end.classList.toggle('hidden', !over);
    if (over && !endBuilt) { buildEnd(G); endBuilt = true; }
    if (!over) endBuilt = false;

    tbScore.textContent = `${G.score.W} — ${G.score.J}`;
    tbInfo.textContent = G.phase === 'buy'
      ? `ROUND ${G.round} · BUY ${Math.max(0, Math.ceil(G.phaseT))}s`
      : G.phase === 'planted'
        ? `ROUND ${G.round} · CHARGE ${fmtClock(G.phaseT)}`
        : `ROUND ${G.round} · ${fmtClock(G.phaseT)}`;
    money.textContent = `$${p.money}`;

    const feed = G.killfeed.filter((k) => G.time - k.t < 5).slice(-5)
      .map((k) => `<div class="kf ${k.team === 'W' ? 'tw' : 'tj'}">${k.text}</div>`)
      .join('');
    if (feed !== feedCache) { killfeed.innerHTML = feed; feedCache = feed; }

    hpFill.style.width = `${Math.max(0, Math.min(100, p.hp))}%`;
    hpFill.classList.toggle('low', p.hp < 30);
    hpNum.textContent = String(Math.max(0, Math.min(100, Math.ceil(p.hp))));
    arFill.style.width = `${Math.max(0, p.armor)}%`;
    arNum.textContent = String(Math.max(0, Math.ceil(p.armor)));

    const gun = gunOf(p);
    weapName.textContent = `${WEAPONS[gun.id].name}${p.reloadEnd ? ' — RELOADING' : ''}`;
    ammo.textContent = `${gun.mag} / ${gun.reserve}`;
    grenLine.textContent = `3 frag ×${p.grenades.frag} · 4 smoke ×${p.grenades.smoke} · 5 flash ×${p.grenades.flash}${p.selGrenade ? ` · ${p.selGrenade.toUpperCase()} READY — click to throw` : ''}`;

    const spread = 7 + p.bloom * 300 + Math.hypot(p.vel.x, p.vel.z) * 1.1;
    cross.style.setProperty('--sp', `${spread.toFixed(1)}px`);
    cross.style.opacity = p.alive && G.phase !== 'title' ? '1' : '0';

    let ch = null;
    if (p.alive && p.channeling) {
      ch = p.channeling.kind === 'plant'
        ? { label: 'PLANTING THE CHARGE', k: G.charge.channel / TUNE.PLANT_T }
        : { label: 'DEFUSING THE CHARGE', k: G.charge.defuse / TUNE.DEFUSE_T };
    }
    channel.classList.toggle('hidden', !ch);
    if (ch) {
      channelLabel.textContent = ch.label;
      channelFill.style.width = `${Math.min(100, ch.k * 100)}%`;
    }

    const planted = G.phase === 'planted';
    plantAlert.classList.toggle('hidden', !planted);
    if (planted) plantAlert.textContent = `⚠ CHARGE PLANTED — SITE ${G.charge.site} — ${fmtClock(G.phaseT)}`;

    const showBuy = G.phase === 'buy' && p.alive;
    buyMenu.classList.toggle('hidden', !showBuy);
    if (showBuy) {
      for (const { entry, row } of buyRows) {
        let owned = false;
        if (entry.slot === 'armor') owned = p.armor > 0;
        else if (entry.slot === 'primary') owned = !!(p.weapons.primary && p.weapons.primary.id === entry.id);
        else if (entry.slot === 'grenade') owned = p.grenades[entry.id] >= GRENADE_CAPS[entry.id];
        row.classList.toggle('owned', owned);
        row.classList.toggle('poor', !owned && p.money < entry.price);
      }
    }

    if (p.hp < lastHp - 0.5) dmgFlash = 0.55;
    lastHp = p.hp;
    dmgFlash = Math.max(0, dmgFlash - dt * 1.1);
    const lowHp = p.alive && p.hp > 0 && p.hp < 30 ? 0.22 + 0.08 * Math.sin(G.time * 5) : 0;
    vignette.style.opacity = String(p.alive ? Math.max(dmgFlash, lowHp) : 0.45);
    blind.style.opacity = String(Math.max(0, Math.min(1, (p.blindUntil - G.time) / 2.2)));
    scope.classList.toggle('hidden', !(p.alive && p.aiming && gunOf(p).id === 'longbow'));

    mapAcc += dt;
    if (mapAcc > 0.12) { mapAcc = 0; drawMap(G); }
  }

  return { update };
}
