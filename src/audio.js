// Procedural WebAudio sound: jet engine drone, cannon, missiles, explosions,
// lock / warning tones. Nothing is loaded from the network.
export class GameAudio {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.paused = false;
    try {
      const v = localStorage.getItem('skyward.audio');
      if (v === '0') this.enabled = false;
    } catch { /* storage blocked */ }
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.55 : 0;
    this.master.connect(ctx.destination);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('skyward.audio', on ? '1' : '0'); } catch { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(on && !this.paused ? 0.55 : 0, this.ctx.currentTime, 0.05);
  }

  setPaused(p) {
    this.paused = p;
    if (this.master) this.master.gain.setTargetAtTime(this.enabled && !p ? 0.55 : 0, this.ctx.currentTime, 0.05);
  }

  _noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  startEngine() {
    const ctx = this.ensure();
    if (!ctx || this.engine) return;
    const src = this._noiseSrc(true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.value = 220;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    src.connect(lp).connect(g);
    src.connect(bp).connect(g);
    whine.connect(wg).connect(this.master);
    g.connect(this.master);
    src.start();
    whine.start();
    // gun loop
    const gsrc = this._noiseSrc(true);
    const gbp = ctx.createBiquadFilter();
    gbp.type = 'bandpass';
    gbp.frequency.value = 900;
    gbp.Q.value = 0.8;
    const gg = ctx.createGain();
    gg.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 14;
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg).connect(gg.gain);
    gsrc.connect(gbp).connect(gg).connect(this.master);
    gsrc.start();
    lfo.start();
    this.engine = { src, lp, bp, g, whine, wg, gsrc, gg, lfo };
  }

  stopEngine() {
    if (!this.engine) return;
    const e = this.engine;
    for (const n of [e.src, e.whine, e.gsrc, e.lfo]) try { n.stop(); } catch { /* already */ }
    this.engine = null;
  }

  setEngine(throttle, boosting, alive) {
    const e = this.engine;
    if (!e) return;
    const t = this.ctx.currentTime;
    const v = alive ? 0.16 + throttle * 0.18 + (boosting ? 0.12 : 0) : 0;
    e.g.gain.setTargetAtTime(v, t, 0.15);
    e.lp.frequency.setTargetAtTime(350 + throttle * 900 + (boosting ? 700 : 0), t, 0.2);
    e.bp.frequency.setTargetAtTime(1400 + throttle * 1600, t, 0.2);
    e.whine.frequency.setTargetAtTime(180 + throttle * 260 + (boosting ? 120 : 0), t, 0.2);
    e.wg.gain.setTargetAtTime(alive ? 0.012 + (boosting ? 0.01 : 0) : 0, t, 0.2);
  }

  setGun(on) {
    const e = this.engine;
    if (!e) return;
    e.gg.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, on ? 0.01 : 0.03);
  }

  _burst({ dur = 0.3, freq = 800, type = 'lowpass', gain = 0.5, q = 0.7, attack = 0.005 } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this._noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return f;
  }

  _tone(freq, dur, { type = 'sine', gain = 0.15, slide = 0, delay = 0 } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(name, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const dist = opts.distance ?? 300;
    const att = Math.max(0.05, Math.min(1, 600 / Math.max(dist, 60)));
    switch (name) {
      case 'explosion': {
        const sz = opts.size || 1;
        this._burst({ dur: 1.2 + sz * 0.6, freq: 260, gain: 0.9 * att * Math.min(1.4, sz), attack: 0.01 });
        this._burst({ dur: 0.35, freq: 1800, type: 'bandpass', gain: 0.35 * att });
        this._tone(70, 0.9, { type: 'sine', gain: 0.4 * att, slide: -40 });
        break;
      }
      case 'hit':
        this._burst({ dur: 0.08, freq: 2600, type: 'bandpass', gain: 0.25, q: 3 });
        break;
      case 'playerHit':
        this._burst({ dur: 0.2, freq: 500, gain: 0.6 });
        this._tone(140, 0.15, { type: 'square', gain: 0.08 });
        break;
      case 'missile':
        this._burst({ dur: 1.4, freq: opts.enemy ? 900 : 1400, type: 'bandpass', gain: opts.enemy ? 0.15 : 0.45, q: 1.2, attack: 0.04 });
        break;
      case 'warning':
        for (let i = 0; i < 4; i++) this._tone(1240, 0.09, { type: 'square', gain: 0.07, delay: i * 0.16 });
        break;
      case 'lock':
        this._tone(1760, 0.5, { type: 'sine', gain: 0.1 });
        break;
      case 'target':
        this._tone(880, 0.06, { type: 'triangle', gain: 0.08 });
        break;
      case 'kill':
        this._tone(660, 0.12, { type: 'triangle', gain: 0.1 });
        this._tone(990, 0.2, { type: 'triangle', gain: 0.1, delay: 0.1 });
        break;
      case 'wave':
        this._tone(440, 0.25, { type: 'sawtooth', gain: 0.05 });
        this._tone(660, 0.4, { type: 'sawtooth', gain: 0.05, delay: 0.2 });
        break;
      case 'enemyGun':
        this._burst({ dur: 0.06, freq: 700, type: 'bandpass', gain: 0.2 * att, q: 1 });
        break;
      case 'dry':
        this._tone(220, 0.05, { type: 'square', gain: 0.05 });
        break;
      case 'ui':
        this._tone(1320, 0.05, { type: 'triangle', gain: 0.06 });
        break;
      default:
        break;
    }
  }
}
