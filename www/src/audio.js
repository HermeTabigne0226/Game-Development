// Lightweight Web Audio API retro RPG sound synthesizer

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volumeScale = 1.0;
  }

  setLevel(level) {
    const map = { off: 0, low: 0.45, med: 0.75, high: 1.0 };
    const scale = map[level] ?? 1.0;
    this.muted = scale === 0;
    this.volumeScale = scale;
  }

  _ensureCtx() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playTone(freq, duration, type = "square", volume = 0.08, slideTo = null) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    }
    gain.gain.setValueAtTime(volume * this.volumeScale, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  step() { this.playTone(130, 0.04, "triangle", 0.04, 90); }
  slash() {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Crisp white-noise blade whoosh
    const dur = 0.13;
    const bufSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(520, now + dur);
    filter.Q.value = 1.4;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.18, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
    // Metallic blade slice
    this.playTone(620, 0.09, "sawtooth", 0.06, 170);
  }
  hit() { this.playTone(140, 0.12, "square", 0.1, 55); }
  dash() { this.playTone(260, 0.14, "triangle", 0.09, 620); }
  arrow() {
    this.playTone(540, 0.07, "triangle", 0.08, 220);
    this.playTone(920, 0.05, "sine", 0.04, 480);
  }
  magicOrb() {
    this.playTone(680, 0.11, "sine", 0.07, 410);
    this.playTone(1040, 0.08, "triangle", 0.04, 620);
  }
  smite() {
    this.playTone(660, 0.18, "sine", 0.09, 330);
    setTimeout(() => this.playTone(180, 0.18, "triangle", 0.1, 70), 60);
  }
  frost() {
    this.playTone(980, 0.16, "sine", 0.08, 420);
    this.playTone(1320, 0.12, "triangle", 0.05, 720);
  }
  nova() {
    this.playTone(330, 0.24, "sawtooth", 0.08, 165);
    this.playTone(495, 0.22, "sine", 0.07, 660);
  }
  gravityPull() {
    this.playTone(135, 0.28, "sine", 0.09, 55);
    this.playTone(220, 0.22, "triangle", 0.05, 85);
  }
  ultLeap() { this.playTone(200, 0.35, "sine", 0.09, 680); }
  ultSlam() {
    this.playTone(95, 0.38, "sawtooth", 0.14, 32);
    this.playTone(160, 0.25, "square", 0.1, 45);
  }
  heavyImpact() {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.24;
    const bufSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 1.8);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + dur);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.22 * this.volumeScale, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
    this.playTone(88, 0.32, "sine", 0.16, 32);
    this.playTone(145, 0.18, "triangle", 0.1, 52);
  }
  shieldClang() {
    this.playTone(680, 0.14, "triangle", 0.09, 510);
    this.playTone(1040, 0.18, "sine", 0.07, 790);
  }
  bossWarn() {
    this.playTone(110, 0.36, "sawtooth", 0.08, 165);
    setTimeout(() => this.playTone(165, 0.34, "triangle", 0.09, 220), 90);
  }
  critHit() {
    this.playTone(920, 0.08, "triangle", 0.07, 1380);
  }
  windVolley() {
    this.playTone(460, 0.12, "triangle", 0.08, 220);
    setTimeout(() => this.playTone(640, 0.1, "sine", 0.06, 340), 45);
    setTimeout(() => this.playTone(760, 0.09, "triangle", 0.05, 420), 90);
  }
  pierceShot() {
    this.playTone(840, 0.14, "sawtooth", 0.07, 320);
    this.playTone(1260, 0.11, "sine", 0.06, 620);
  }
  spell() { this.playTone(520, 0.22, "sine", 0.09, 880); }
  heal() {
    this.playTone(440, 0.12, "sine", 0.07, 554);
    setTimeout(() => this.playTone(659, 0.18, "sine", 0.07, 880), 80);
  }
  loot() {
    this.playTone(587, 0.09, "triangle", 0.08);
    setTimeout(() => this.playTone(880, 0.15, "triangle", 0.08), 70);
  }
  levelUp() {
    [440, 554, 659, 880].forEach((f, i) => {
      setTimeout(() => this.playTone(f, 0.14, "triangle", 0.09), i * 85);
    });
  }
  stairs() { this.playTone(220, 0.24, "sine", 0.08, 440); }
}

export const sfx = new SoundEngine();

const BGM_TRACKS = {
  town: "assets/audio/new audio/snes_shattered_crown_menu.wav",
  explore: "assets/audio/new audio/snes_shattered_crown_no_enemy.wav",
  battle: "assets/audio/new audio/snes_shattered_crown_combat.wav",
  boss: "assets/audio/new audio/snes_shattered_crown_boss.wav",
};

class MusicPlayer {
  constructor() {
    this.currentKey = null;
    this.audio = null;
    this.muted = false;
    this.volume = 0.22;
  }

  setLevel(level) {
    const map = { off: 0, low: 0.14, med: 0.28, high: 0.48 };
    const vol = map[level] ?? 0.22;
    this.volume = vol;
    this.setMuted(vol === 0);
  }

  play(key) {
    if (this.currentKey === key && this.audio) {
      if (!this.muted && this.audio.paused) {
        this.audio.play().catch(() => {});
      }
      return;
    }
    this.currentKey = key;
    const src = BGM_TRACKS[key];
    if (!src) return;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.loop = true;
      this.audio.preload = "metadata";
    } else {
      this.audio.pause();
    }
    this.audio.src = src;
    this.audio.currentTime = 0;
    this.audio.volume = this.muted ? 0 : this.volume;
    if (!this.muted) {
      this.audio.play().catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.audio) {
      this.audio.volume = muted ? 0 : this.volume;
      if (muted) this.audio.pause();
      else this.audio.play().catch(() => {});
    }
  }

  unlock() {
    if (this.audio && !this.muted && this.audio.paused) {
      this.audio.play().catch(() => {});
    }
  }

  pauseForBackground() {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }

  resumeFromBackground() {
    if (this.audio && !this.muted && this.audio.paused) {
      this.audio.play().catch(() => {});
    }
  }
}

export const bgm = new MusicPlayer();
