// audio.js — every sound in Palm Cove Heat is synthesised with WebAudio at
// run time: engine hum, police sirens, gunshots, cash-register jingles, phone
// blips and UI clicks. There are no audio files anywhere in the game.

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
    this.muted = false;
  }

  /** Create the context lazily; browsers require a user gesture first. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.03);
    }
  }

  /** A short filtered noise burst, the base of gunshots and impacts. */
  noiseBurst(duration, freq, gain, type) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type || 'lowpass';
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  /** One oscillator blip with an exponential decay envelope. */
  blip(freq, duration, gain, type, slideTo) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  shot() {
    this.noiseBurst(0.14, 1800, 0.5, 'lowpass');
    this.blip(160, 0.1, 0.25, 'sawtooth', 60);
  }

  policeShot() {
    this.noiseBurst(0.1, 2400, 0.28, 'bandpass');
  }

  hit() {
    this.noiseBurst(0.08, 500, 0.35, 'lowpass');
  }

  crash(intensity) {
    this.noiseBurst(0.22, 700, Math.min(0.6, 0.2 + intensity * 0.4), 'lowpass');
    this.blip(90, 0.18, 0.3, 'triangle', 45);
  }

  door() {
    this.blip(220, 0.07, 0.2, 'triangle');
    setTimeout(() => this.blip(160, 0.09, 0.2, 'triangle'), 70);
  }

  phone() {
    this.blip(1180, 0.09, 0.16, 'sine');
    setTimeout(() => this.blip(1560, 0.12, 0.16, 'sine'), 110);
  }

  cash() {
    const notes = [880, 1108, 1318, 1760];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 0.18, 'triangle'), i * 70));
  }

  fail() {
    this.blip(320, 0.25, 0.22, 'sawtooth', 140);
    setTimeout(() => this.blip(210, 0.35, 0.22, 'sawtooth', 90), 160);
  }

  sting() {
    // The BUSTED / WASTED two-note sting.
    this.blip(392, 0.3, 0.25, 'triangle');
    setTimeout(() => this.blip(262, 0.55, 0.25, 'triangle'), 240);
  }

  click() {
    this.blip(660, 0.05, 0.15, 'square');
  }

  /** Start the looping engine hum (called when the player gets in a car). */
  engineStart() {
    if (!this.ensure() || this.engineOsc) return;
    const t = this.ctx.currentTime;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.0001, t);
    this.engineGain.gain.exponentialRampToValueAtTime(0.12, t + 0.2);
    this.engineOsc.connect(filter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start(t);
  }

  /** Feed the current speed fraction (0..1) into the engine hum. */
  engineUpdate(speedFraction) {
    if (!this.engineOsc || !this.ctx) return;
    const f = 55 + speedFraction * 165;
    this.engineOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.06);
  }

  engineStop() {
    if (!this.engineOsc || !this.ctx) return;
    const osc = this.engineOsc;
    const gain = this.engineGain;
    gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
    setTimeout(() => {
      try { osc.stop(); } catch (e) { /* already stopped */ }
    }, 300);
    this.engineOsc = null;
    this.engineGain = null;
  }

  /** Start the two-tone police siren loop (volume follows distance). */
  sirenStart() {
    if (!this.ensure() || this.sirenOsc) return;
    const t = this.ctx.currentTime;
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 760;
    this.sirenLfo = this.ctx.createOscillator();
    this.sirenLfo.type = 'square';
    this.sirenLfo.frequency.value = 0.9;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 130;
    this.sirenLfo.connect(lfoGain).connect(this.sirenOsc.frequency);
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0.0;
    this.sirenOsc.connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start(t);
    this.sirenLfo.start(t);
  }

  sirenUpdate(volume) {
    if (this.sirenGain && this.ctx) {
      this.sirenGain.gain.setTargetAtTime(Math.max(0, Math.min(0.16, volume)), this.ctx.currentTime, 0.1);
    }
  }

  sirenStop() {
    if (!this.sirenOsc || !this.ctx) return;
    const osc = this.sirenOsc;
    const lfo = this.sirenLfo;
    const gain = this.sirenGain;
    gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
    setTimeout(() => {
      try { osc.stop(); } catch (e) { /* already stopped */ }
      try { lfo.stop(); } catch (e) { /* already stopped */ }
    }, 200);
    this.sirenOsc = null;
    this.sirenLfo = null;
    this.sirenGain = null;
  }
}
