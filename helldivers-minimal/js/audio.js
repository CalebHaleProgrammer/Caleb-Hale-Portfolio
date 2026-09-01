// Minimal procedural audio using Web Audio API
const AudioSys = {
  ctx: null,
  volume: 0.7,
  enabled: true,

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.enabled = false;
    }
  },

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
  },

  playTone(freq, duration, type = 'square', vol = 0.15) {
    if (!this.enabled || !this.ctx || this.volume === 0) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  },

  shoot() { this.playTone(180, 0.08, 'square', 0.12); },
  hit() { this.playTone(90, 0.12, 'sawtooth', 0.18); },
  enemyHit() { this.playTone(220, 0.06, 'triangle', 0.1); },
  enemyDie() { this.playTone(60, 0.25, 'sawtooth', 0.2); },
  reload() { this.playTone(400, 0.1, 'sine', 0.1); this.playTone(300, 0.15, 'sine', 0.08); },
  stratagem() { this.playTone(600, 0.08, 'square', 0.12); },
  stratagemReady() { this.playTone(800, 0.15, 'square', 0.15); this.playTone(1000, 0.2, 'square', 0.12); },
  extract() { this.playTone(440, 0.3, 'sine', 0.15); },
  ui() { this.playTone(500, 0.05, 'sine', 0.08); },
  death() { this.playTone(80, 0.4, 'sawtooth', 0.25); this.playTone(40, 0.5, 'sawtooth', 0.2); }
};
