/**
 * Web Audio API Procedural Sound Engine for Card Wars v3
 * 
 * Synthesizes punchy, nostalgic, cartoon-style sound effects in the spirit of
 * Adventure Time (Land of Ooo) without requiring external audio downloads:
 * - Card plays, draws, and flips (tactile paper & wood drops)
 * - Floop activation (whimsical resonant pitch shift)
 * - Creature combat hits ("POW!", "WHAM!") and hero critical damage (sub-bass boom)
 * - Gong turn transitions ("В БОЙ!") and fuse timer ticks
 * - Land freezing and healing chimes
 */

export interface SoundSettings {
  muted: boolean;
  volume: number; // 0.0 to 1.0
  shakeEnabled: boolean;
  musicEnabled: boolean;
}

const SETTINGS_KEY = 'card-wars-audio-settings-v1';

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        muted: Boolean(parsed.muted),
        volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : 0.7,
        shakeEnabled: parsed.shakeEnabled !== false,
        musicEnabled: Boolean(parsed.musicEnabled),
      };
    }
  } catch {
    // ignore
  }
  return { muted: false, volume: 0.7, shakeEnabled: true, musicEnabled: false };
}

function saveSettings(settings: SoundSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicChord = 0;
  private settings: SoundSettings = loadSettings();
  private initialized = false;
  private lastTickSecond = -1;
  private lastFinishSoundAt = 0;

  // Ukulele chords in Land of Ooo acoustic style: C, Am, F, G
  private readonly chords = [
    [261.63, 329.63, 392.00, 523.25], // C
    [220.00, 261.63, 329.63, 440.00], // Am
    [174.61, 220.00, 261.63, 349.23], // F
    [196.00, 246.94, 293.66, 392.00], // G
  ];

  constructor() {
    // AudioContext will be initialized or resumed on the first user interaction
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.ensureContext();
        if (this.settings.musicEnabled) {
          this.startMusic();
        }
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();

      // Master Compressor to prevent clipping during chaotic multiplayer matches
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(30, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.settings.muted ? 0 : this.settings.volume, this.ctx.currentTime);

      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
      this.initialized = true;
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {
        // will resume on next user gesture
      });
    }

    return this.ctx;
  }

  public getSettings(): SoundSettings {
    return { ...this.settings };
  }

  public setMuted(muted: boolean): void {
    this.settings.muted = muted;
    saveSettings(this.settings);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.settings.volume, this.ctx.currentTime, 0.02);
    }
  }

  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.settings.volume = clamped;
    saveSettings(this.settings);
    if (this.masterGain && this.ctx && !this.settings.muted) {
      this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  public setShakeEnabled(enabled: boolean): void {
    this.settings.shakeEnabled = enabled;
    saveSettings(this.settings);
  }

  public isShakeEnabled(): boolean {
    return this.settings.shakeEnabled;
  }

  public isMusicEnabled(): boolean {
    return this.settings.musicEnabled;
  }

  /**
   * Start procedural warm acoustic ukulele background music.
   */
  public startMusic(): void {
    if (this.musicTimer !== null) return;
    this.settings.musicEnabled = true;
    saveSettings(this.settings);
    this.scheduleMusicBeat();
    if (typeof window !== 'undefined') {
      this.musicTimer = window.setInterval(() => this.scheduleMusicBeat(), 280);
    }
  }

  /**
   * Stop background music.
   */
  public stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.settings.musicEnabled = false;
    saveSettings(this.settings);
  }

  /**
   * Toggle background music on/off.
   */
  public toggleMusic(): boolean {
    if (this.musicTimer !== null || this.settings.musicEnabled) {
      this.stopMusic();
      return false;
    } else {
      this.startMusic();
      return true;
    }
  }

  private scheduleMusicBeat(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted || !this.settings.musicEnabled) return;

    if (!this.musicGain) {
      this.musicGain = ctx.createGain();
      this.musicGain.gain.setValueAtTime(0.16, ctx.currentTime);
      this.musicGain.connect(this.masterGain!);
    }

    const t = ctx.currentTime;
    const chord = this.chords[this.musicChord % this.chords.length]!;
    const noteFreq = chord[this.musicStep % chord.length]!;
    this.playPluckNote(ctx, noteFreq, t, 0.42);

    // Warm bass accompaniment on the 1st beat of each chord
    if (this.musicStep === 0) {
      this.playPluckNote(ctx, chord[0]! * 0.5, t, 0.62);
    }

    this.musicStep = (this.musicStep + 1) % 4;
    if (this.musicStep === 0) {
      this.musicChord = (this.musicChord + 1) % this.chords.length;
    }
  }

  private playPluckNote(ctx: AudioContext, freq: number, startTime: number, duration: number): void {
    if (!this.musicGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, startTime);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1300, startTime);
    filter.frequency.exponentialRampToValueAtTime(320, startTime + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(0.18, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  /**
   * Random pitch variation (±60-70 cents) to prevent auditory fatigue on repeated actions (docs/AUDIT-KIBERBUS-UIUX.md §6.4).
   */
  public randomDetune(cents = 65): number {
    return (Math.random() * 2 - 1) * cents;
  }

  public applyPitchVariance(osc: OscillatorNode, startTime: number, cents = 65): void {
    try {
      if (osc && osc.detune) {
        osc.detune.setValueAtTime(this.randomDetune(cents), startTime);
      }
    } catch {
      // ignore in test or unsupported environments
    }
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number, expDecayTimeConst?: number): AudioBuffer {
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const sample = Math.random() * 2 - 1;
      data[i] = expDecayTimeConst ? sample * Math.exp(-i / (ctx.sampleRate * expDecayTimeConst)) : sample;
    }
    return noiseBuffer;
  }

  /**
   * Card Hover: Subtle, airy paper-brush whisper when hovering a card in hand.
   */
  public playCardHover(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.045;

    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, dur, 0.015);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2400, t);
    filter.frequency.exponentialRampToValueAtTime(3600, t + dur);
    filter.Q.setValueAtTime(2.0, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.005, t);
    gain.gain.linearRampToValueAtTime(0.11, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    noise.start(t);
    noise.stop(t + dur);
  }

  /**
   * Card Select: Crisp, cheerful tactile pop when selecting a card or target.
   */
  public playCardSelect(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.075;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(360, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + dur);
    this.applyPitchVariance(osc, t, 55);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.28, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + dur);
  }

  /**
   * Card Discard: Soft downward paper whoosh + muffled wooden thud.
   */
  public playCardDiscard(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.14;

    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, dur, 0.04);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1700, t);
    filter.frequency.exponentialRampToValueAtTime(420, t + dur);
    filter.Q.setValueAtTime(1.8, t);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.01, t);
    noiseGain.gain.linearRampToValueAtTime(0.28, t + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain!);
    noise.start(t);
    noise.stop(t + dur);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(140, t);
    thud.frequency.exponentialRampToValueAtTime(52, t + 0.09);
    this.applyPitchVariance(thud, t, 50);

    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.25, t);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    thud.connect(thudGain);
    thudGain.connect(this.masterGain!);
    thud.start(t);
    thud.stop(t + 0.09);
  }

  /**
   * Turn Start: Bright marimba/ukulele chime for own turn, softer wood tap for opponent turn.
   */
  public playTurnStart(isMine = true): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const notes = isMine ? [392.0, 523.25, 659.25] : [329.63, 293.66];
    const peak = isMine ? 0.26 : 0.14;

    notes.forEach((freq, idx) => {
      const start = t + idx * 0.065;
      const dur = isMine ? 0.24 : 0.14;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      this.applyPitchVariance(osc, start, 30);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + dur);
    });
  }

  /**
   * Card Draw / Deal: Soft filtered white noise sweep with crisp snap.
   */
  public playCardDraw(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.14;

    // Buffer of white noise
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(3200, t + dur);
    filter.Q.setValueAtTime(2.5, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    whiteNoise.start(t);
    whiteNoise.stop(t + dur);
  }

  /**
   * Card Play: Satisfying tactile slap onto the wooden table.
   */
  public playCardPlay(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;

    // 1. Thump: quick descending sine wave
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    this.applyPitchVariance(osc, t, 65);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.65, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.09);

    // 2. Paper slap transient: short bandpass noise
    const noiseDur = 0.07;
    const bufferSize = Math.floor(ctx.sampleRate * noiseDur);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, t);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + noiseDur);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain!);

    noise.start(t);
    noise.stop(t + noiseDur);
  }

  /**
   * Floop: Whimsical Adventure Time style upward frequency bend ("bloop!").
   */
  public playFloop(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.22;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(680, t + dur * 0.6);
    osc.frequency.exponentialRampToValueAtTime(520, t + dur);
    this.applyPitchVariance(osc, t, 60);

    // Resonant harmonic for cartoon richness
    const harm = ctx.createOscillator();
    harm.type = 'triangle';
    harm.frequency.setValueAtTime(520, t);
    harm.frequency.exponentialRampToValueAtTime(1360, t + dur * 0.6);
    harm.frequency.exponentialRampToValueAtTime(1040, t + dur);
    this.applyPitchVariance(harm, t, 60);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.45, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    const harmGain = ctx.createGain();
    harmGain.gain.setValueAtTime(0.2, t);
    harmGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    harm.connect(harmGain);
    harmGain.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    harm.start(t);
    osc.stop(t + dur);
    harm.stop(t + dur);
  }

  /**
   * Creature Attack Hit: Punchy comic impact ("POW!").
   */
  public playAttackHit(amount = 1): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const intensity = Math.min(1.8, 0.7 + amount * 0.15);

    // 1. Transient smack
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    this.applyPitchVariance(osc, t, 70);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55 * intensity, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + 0.15);

    // 2. Punch noise crackle
    const noiseDur = 0.08;
    const bufferSize = Math.floor(ctx.sampleRate * noiseDur);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4 * intensity, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + noiseDur);

    noise.connect(noiseGain);
    noiseGain.connect(this.masterGain!);
    noise.start(t);
    noise.stop(t + noiseDur);
  }

  /**
   * Hero Damage: Heavy bass impact with deep rumble.
   */
  public playHeroDamage(amount = 1): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.45;
    // Heavier hits are louder (capped so big numbers never clip).
    const punch = Math.min(1, 0.7 + Math.max(0, amount - 1) * 0.1);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + dur);
    this.applyPitchVariance(osc, t, 50);

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(20, t + dur);
    this.applyPitchVariance(sub, t, 50);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.75 * punch, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    sub.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    sub.start(t);
    osc.stop(t + dur);
    sub.stop(t + dur);
  }

  /**
   * Combat Gong / Big Turn Button ("В БОЙ!"):
   * Resonant brass gong strike with metallic warmth and gentle decay.
   */
  public playGong(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 1.35;

    // Inharmonic frequencies typical of a Tibetan/brass gong
    const freqs = [185, 290, 420, 560, 810];
    const weights = [0.65, 0.35, 0.25, 0.18, 0.1];

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = idx === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.96, t + dur);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime((weights[idx] ?? 0) * 0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(t);
      osc.stop(t + dur);
    });
  }

  /**
   * Fuse Timer Tick: Crisp rhythmic tick for the last seconds of the turn.
   */
  public playFuseTick(urgent = false): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const freq = urgent ? 1350 : 880;
    const dur = urgent ? 0.05 : 0.035;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
    this.applyPitchVariance(osc, t, 50);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(urgent ? 0.45 : 0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    osc.stop(t + dur);
  }

  /**
   * Land Freeze: Glassy crystalline ice crackle.
   */
  public playFreeze(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.32;

    const freqs = [1200, 1750, 2400];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + i * 0.05);
      osc.frequency.exponentialRampToValueAtTime(f * 1.3, t + dur);
      this.applyPitchVariance(osc, t + i * 0.05, 60);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.2, t + i * 0.05 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t + i * 0.05);
      osc.stop(t + dur);
    });
  }

  /**
   * Heal: Ascending sparkle chime.
   */
  public playHeal(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 (Major triad)

    notes.forEach((freq, idx) => {
      const startTime = t + idx * 0.06;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      this.applyPitchVariance(osc, startTime, 40);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.25, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.28);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(startTime);
      osc.stop(startTime + 0.28);
    });
  }

  /**
   * UI Wood Button Click / Tab Switch.
   */
  public playButtonClick(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.04;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + dur);
    this.applyPitchVariance(osc, t, 65);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    osc.stop(t + dur);
  }

  /**
   * Emote voice squeak / cartoon chirps.
   */
  public playEmoteChirp(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(380, t);
    osc.frequency.linearRampToValueAtTime(740, t + 0.08);
    osc.frequency.linearRampToValueAtTime(560, t + 0.16);
    this.applyPitchVariance(osc, t, 70);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    osc.stop(t + 0.18);
  }

  /**
   * Victory Fanfare: Triumphant brass fanfare in major triad (C5, G5, C6, E6).
   */
  public playVictoryFanfare(): void {
    const nowMs = Date.now();
    if (nowMs - this.lastFinishSoundAt < 1000) return;
    this.lastFinishSoundAt = nowMs;

    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const notes = [
      { f: 523.25, time: 0, dur: 0.16 }, // C5
      { f: 659.25, time: 0.16, dur: 0.16 }, // E5
      { f: 783.99, time: 0.32, dur: 0.22 }, // G5
      { f: 1046.5, time: 0.54, dur: 0.9 }, // C6
    ];

    notes.forEach((n) => {
      const start = t + n.time;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.f, start);

      const harm = ctx.createOscillator();
      harm.type = 'sawtooth';
      harm.frequency.setValueAtTime(n.f * 2, start);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, start);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.35, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);

      const harmGain = ctx.createGain();
      harmGain.gain.setValueAtTime(0.12, start);
      harmGain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);

      osc.connect(gain);
      harm.connect(harmGain);
      harmGain.connect(gain);
      gain.connect(filter);
      filter.connect(this.masterGain!);

      osc.start(start);
      harm.start(start);
      osc.stop(start + n.dur);
      harm.stop(start + n.dur);
    });
  }

  /**
   * Defeat Sound: Sad cartoon descending slide whistle.
   */
  public playDefeatSound(): void {
    const nowMs = Date.now();
    if (nowMs - this.lastFinishSoundAt < 1000) return;
    this.lastFinishSoundAt = nowMs;

    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.9;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.linearRampToValueAtTime(190, t + 0.35);
    osc.frequency.linearRampToValueAtTime(130, t + 0.7);
    osc.frequency.exponentialRampToValueAtTime(65, t + dur);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    osc.stop(t + dur);
  }

  public playVictory(): void {
    this.playVictoryFanfare();
  }

  public playDefeat(): void {
    this.playDefeatSound();
  }

  public playLandFreeze(): void {
    this.playFreeze();
  }

  public playEmote(): void {
    this.playEmoteChirp();
  }

  /**
   * Tomato Throw: Comedic cartoon arcing whistle + air whoosh.
   */
  public playTomatoThrow(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.32;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(640, t + dur * 0.45);
    osc.frequency.exponentialRampToValueAtTime(320, t + dur);
    this.applyPitchVariance(osc, t, 60);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + dur);
  }

  /**
   * Tomato Splat: Wet, squishy cartoon splat impact.
   */
  public playTomatoSplat(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.2;

    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, dur, 0.045);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + dur);
    filter.Q.setValueAtTime(3.2, t);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.45, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain!);
    noise.start(t);
    noise.stop(t + dur);

    const blorp = ctx.createOscillator();
    blorp.type = 'sine';
    blorp.frequency.setValueAtTime(240, t);
    blorp.frequency.exponentialRampToValueAtTime(65, t + 0.13);
    this.applyPitchVariance(blorp, t, 70);

    const blorpGain = ctx.createGain();
    blorpGain.gain.setValueAtTime(0.38, t);
    blorpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

    blorp.connect(blorpGain);
    blorpGain.connect(this.masterGain!);
    blorp.start(t);
    blorp.stop(t + 0.13);
  }

  /**
   * Error / Invalid Action: Gentle cartoon "nope" double-bonk.
   */
  public playError(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const notes = [220, 155];
    notes.forEach((freq, idx) => {
      const start = t + idx * 0.085;
      const dur = 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, start);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.85, start + dur);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(620, start);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.01, start);
      gain.gain.linearRampToValueAtTime(0.24, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + dur);
    });
  }

  /**
   * Modal Open: Soft buoyant upward pop.
   */
  public playModalOpen(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.085;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(480, t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + dur);
  }

  /**
   * Modal Close: Soft downward tuck pop.
   */
  public playModalClose(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const dur = 0.07;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + dur);
  }

  /**
   * Deck Save: Rewarding stamp + bright major triad chime.
   */
  public playDeckSave(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.muted) return;

    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const start = t + idx * 0.045;
      const dur = 0.22;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + dur);
    });
  }
}

export const soundEngine = new SoundEngine();
