// All sound is synthesized with WebAudio — oscillators and filtered
// noise, zero audio assets, zero network. Sounds hang off the same event
// queue the effects use; distance to the player attenuates world sounds.

const SHOT_TONE = {
  wasp: [2100, 0.07, 0.16],
  raptor: [1600, 0.09, 0.2],
  mule: [750, 0.16, 0.3],
  vk7: [1250, 0.1, 0.22],
  longbow: [950, 0.2, 0.3],
};

export const audio = {
  ctx: null,
  master: null,
  noise: null,

  init() {
    if (this.ctx) {
      if (this.ctx.resume) this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    } catch (err) {
      this.ctx = null;
    }
  },

  burst(dur, freq, type, gain, when = 0) {
    if (!this.ctx || gain <= 0) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  },

  tone(freqA, freqB, dur, type, gain, when = 0) {
    if (!this.ctx || gain <= 0) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freqA, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freqB), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  },

  handle(G, events) {
    if (!this.ctx) return;
    const p = G.actors[0];
    const dg = (x, z, base) => base / (1 + Math.hypot(p.pos.x - x, p.pos.z - z) * 0.09);
    for (const e of events) {
      switch (e.type) {
        case 'shot': {
          const [f, dur, g0] = SHOT_TONE[e.weapon] || SHOT_TONE.vk7;
          const g = e.actor.isPlayer ? g0 : dg(e.actor.pos.x, e.actor.pos.z, g0);
          if (g < 0.004) break;
          this.burst(dur, f, 'bandpass', g);
          this.tone(170, 55, dur * 0.9, 'triangle', g * 0.7);
          break;
        }
        case 'dry':
          if (e.actor.isPlayer) this.tone(2400, 1800, 0.03, 'square', 0.06);
          break;
        case 'reload':
          if (e.actor.isPlayer) {
            this.tone(900, 500, 0.04, 'square', 0.08);
            this.tone(700, 1100, 0.04, 'square', 0.08, 0.14);
          }
          break;
        case 'hitmark':
          this.tone(1500, 1500, 0.035, 'square', 0.1);
          break;
        case 'hitmarkHead':
          this.tone(2100, 2100, 0.045, 'square', 0.12);
          break;
        case 'killConfirm':
          this.tone(880, 880, 0.06, 'square', 0.12);
          this.tone(1320, 1320, 0.09, 'square', 0.12, 0.12);
          break;
        case 'kill': {
          const g = dg(e.actor.pos.x, e.actor.pos.z, 0.25);
          if (g > 0.01) this.tone(120, 40, 0.25, 'sine', g);
          break;
        }
        case 'buy':
          if (e.actor.isPlayer) this.tone(880, 1170, 0.07, 'sine', 0.12);
          break;
        case 'throw': {
          const g = e.actor.isPlayer ? 0.08 : dg(e.actor.pos.x, e.actor.pos.z, 0.12);
          if (g > 0.005) this.burst(0.15, 1800, 'bandpass', g);
          break;
        }
        case 'boom': {
          const g = Math.min(0.9, dg(e.x, e.z, 0.9));
          this.burst(0.7, 240, 'lowpass', g);
          this.tone(95, 28, 0.7, 'sine', g * 0.9);
          break;
        }
        case 'pop': {
          const g = dg(e.x, e.z, 0.2);
          if (g > 0.01) this.burst(0.12, 3200, 'highpass', g);
          break;
        }
        case 'planted':
          for (let i = 0; i < 3; i++) this.tone(1240, 1240, 0.09, 'sine', 0.14, i * 0.16);
          break;
        case 'roundEnd': {
          const won = e.winner === 'W';
          this.tone(won ? 520 : 392, won ? 520 : 392, 0.12, 'triangle', 0.16);
          this.tone(won ? 780 : 311, won ? 780 : 311, 0.2, 'triangle', 0.16, 0.13);
          break;
        }
        case 'matchEnd': {
          const seq = e.winner === 'W' ? [523, 659, 784, 1046] : [392, 330, 262, 196];
          seq.forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.18, i * 0.16));
          break;
        }
        default:
          break;
      }
    }
  },

  // footsteps: the player's own tread and any bot close enough to hear
  update(G) {
    if (!this.ctx) return;
    const p = G.actors[0];
    for (const a of G.actors) {
      if (!a.alive) continue;
      const sp = Math.hypot(a.vel.x, a.vel.z);
      if (sp < 0.8 || a.pos.y > 0.05) { a.stepAcc = 0; continue; }
      a.stepAcc = (a.stepAcc || 0) + sp / 60;
      const stride = a.crouch ? 1.6 : 2.4;
      if (a.stepAcc >= stride) {
        a.stepAcc = 0;
        const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
        const g = a.isPlayer ? 0.05 : 0.14 / (1 + d * 0.25);
        if (g > 0.006) this.burst(0.05, 500, 'lowpass', g);
      }
    }
  },
};
