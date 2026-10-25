"use client";

// All sound is synthesized with the Web Audio API: no audio files to license
// or download, and the music is re-composed (from a random seed) every game.

export type Sfx = "reveal" | "top" | "strike" | "buzz" | "join" | "sting" | "drumroll" | "applause" | "win" | "whoosh";
export type Mood = "mystic-waltz" | "game-show";

const NOTE = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MoodSpec {
  bpm: number;
  beatsPerBar: number;
  root: number; // midi
  scale: number[]; // semitones
  progressions: number[][]; // scale degrees (0-based)
  lead: "bell" | "pluck";
  drums: boolean;
}

const MOODS: Record<Mood, MoodSpec> = {
  // Harmonic minor waltz with celesta-like bells: wintry, candle-lit, a little mischievous.
  "mystic-waltz": {
    bpm: 92,
    beatsPerBar: 3,
    root: 52, // E3
    scale: [0, 2, 3, 5, 7, 8, 11],
    progressions: [
      [0, 5, 3, 4],
      [0, 3, 6, 2],
      [0, 5, 2, 4],
      [0, 3, 0, 4],
    ],
    lead: "bell",
    drums: false,
  },
  // Bouncy major-key studio groove.
  "game-show": {
    bpm: 118,
    beatsPerBar: 4,
    root: 48, // C3
    scale: [0, 2, 4, 5, 7, 9, 11],
    progressions: [
      [0, 5, 3, 4],
      [0, 3, 4, 3],
      [0, 4, 5, 3],
    ],
    lead: "pluck",
    drums: true,
  },
};

export class FeudAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private mood: Mood = "game-show";
  private nextBeatTime = 0;
  private beat = 0;
  private rng = Math.random;
  private progression: number[] = [];
  private musicLevel = 0.22;
  musicOn = true;
  sfxOn = true;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(ctx.destination);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(2.8);
      const wet = ctx.createGain();
      wet.gain.value = 0.35;
      this.reverb.connect(wet).connect(this.master);
      this.music = ctx.createGain();
      this.music.gain.value = this.musicLevel;
      this.music.connect(this.master);
      this.music.connect(this.reverb);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.7;
      this.sfxBus.connect(this.master);
      this.sfxBus.connect(this.reverb);
      this.noise = this.makeNoise(2);
    }
    void this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  private makeNoise(seconds: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------------------------------------------------------- instruments

  private env(gain: GainNode, t: number, peak: number, attack: number, decay: number) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, out: AudioNode, attack = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    this.env(g, t, peak, attack, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  private bell(freq: number, t: number, peak: number, out: AudioNode) {
    // Inharmonic partials give a celesta / glockenspiel shimmer.
    this.osc("sine", freq, t, 1.6, peak, out);
    this.osc("sine", freq * 2.76, t, 0.6, peak * 0.35, out);
    this.osc("sine", freq * 5.4, t, 0.25, peak * 0.12, out);
  }

  private pluck(freq: number, t: number, peak: number, out: AudioNode) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.25);
    f.connect(out);
    this.osc("sawtooth", freq, t, 0.3, peak, f);
    this.osc("square", freq * 1.005, t, 0.2, peak * 0.4, f);
  }

  private pad(freqs: number[], t: number, dur: number, peak: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1100;
    f.connect(this.music);
    for (const fr of freqs) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = fr;
      o.detune.value = (Math.random() - 0.5) * 12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
      o.connect(g).connect(f);
      o.start(t);
      o.stop(t + dur * 1.1);
    }
  }

  private noiseHit(t: number, dur: number, peak: number, out: AudioNode, filter: BiquadFilterType, freq: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.002, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------- music

  startMusic(mood: Mood, seed = Date.now()) {
    if (!this.ctx) return;
    this.mood = mood;
    this.rng = mulberry32(seed);
    const spec = MOODS[mood];
    this.progression = spec.progressions[Math.floor(this.rng() * spec.progressions.length)];
    this.beat = 0;
    this.nextBeatTime = this.ctx.currentTime + 0.1;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 40);
  }

  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setMusicOn(on: boolean) {
    this.musicOn = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? this.musicLevel : 0, this.ctx.currentTime, 0.3);
  }

  /** Lower the music while the host is talking. */
  duck(on: boolean) {
    if (!this.ctx || !this.musicOn) return;
    this.music.gain.setTargetAtTime(on ? this.musicLevel * 0.35 : this.musicLevel, this.ctx.currentTime, 0.25);
  }

  private degree(spec: MoodSpec, deg: number, octave = 0) {
    const n = spec.scale.length;
    const wrapped = ((deg % n) + n) % n;
    const oct = Math.floor(deg / n) + octave;
    return NOTE(spec.root + spec.scale[wrapped] + 12 * oct);
  }

  private schedule() {
    const ctx = this.ctx!;
    const spec = MOODS[this.mood];
    const spb = 60 / spec.bpm;
    while (this.nextBeatTime < ctx.currentTime + 0.2) {
      const t = this.nextBeatTime;
      const barBeat = this.beat % spec.beatsPerBar;
      const bar = Math.floor(this.beat / spec.beatsPerBar);
      const chordRoot = this.progression[bar % this.progression.length];
      const chord = [chordRoot, chordRoot + 2, chordRoot + 4];

      // Every 8 bars, re-roll the progression so it never loops too obviously.
      if (barBeat === 0 && bar > 0 && bar % 8 === 0) {
        this.progression = spec.progressions[Math.floor(this.rng() * spec.progressions.length)];
      }

      if (barBeat === 0) {
        this.osc("sine", this.degree(spec, chordRoot, -1), t, spb * spec.beatsPerBar * 0.9, 0.35, this.music, 0.02);
        this.pad(chord.map((d) => this.degree(spec, d, 1)), t, spb * spec.beatsPerBar, 0.05);
      }

      if (spec.drums) {
        if (barBeat === 0 || barBeat === 2) this.osc("sine", 60, t, 0.18, 0.5, this.music, 0.002);
        if (barBeat === 1 || barBeat === 3) this.noiseHit(t, 0.12, 0.18, this.music, "bandpass", 1800);
        this.noiseHit(t + spb / 2, 0.04, 0.06, this.music, "highpass", 7000);
        if (barBeat % 2 === 1) this.pluck(this.degree(spec, chordRoot + 4, 1), t + spb / 2, 0.05, this.music);
      } else if (barBeat > 0) {
        this.pad(chord.slice(1).map((d) => this.degree(spec, d, 1)), t, spb * 0.8, 0.025);
      }

      // Lead: two notes per beat, mostly chord tones, sometimes a passing note.
      for (let half = 0; half < 2; half++) {
        if (this.rng() < (spec.lead === "bell" ? 0.22 : 0.45)) continue;
        const tone = chord[Math.floor(this.rng() * 3)] + (this.rng() < 0.2 ? 1 : 0);
        const freq = this.degree(spec, tone, spec.lead === "bell" ? 2 : 1);
        const at = t + half * (spb / 2);
        if (spec.lead === "bell") this.bell(freq, at, 0.12, this.music);
        else this.pluck(freq, at, 0.07, this.music);
      }

      this.nextBeatTime += spb;
      this.beat++;
    }
  }

  // ---------------------------------------------------------- sound effects

  play(name: Sfx) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime + 0.01;
    const out = this.sfxBus;
    switch (name) {
      case "reveal":
        // The classic "ding": a bright bell and a little sparkle.
        this.bell(NOTE(84), t, 0.5, out);
        this.bell(NOTE(91), t + 0.06, 0.3, out);
        break;
      case "top":
        [72, 76, 79, 84, 88].forEach((n, i) => this.bell(NOTE(n), t + i * 0.07, 0.4, out));
        break;
      case "strike": {
        // Harsh, buzzy "eh-errr".
        const f = this.ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 1400;
        f.connect(out);
        this.osc("sawtooth", 110, t, 0.75, 0.5, f, 0.01);
        this.osc("square", 116, t, 0.75, 0.35, f, 0.01);
        this.osc("sawtooth", 55, t, 0.75, 0.3, f, 0.01);
        break;
      }
      case "buzz": {
        const o = this.osc("square", 440, t, 0.25, 0.25, out);
        o.frequency.exponentialRampToValueAtTime(880, t + 0.15);
        break;
      }
      case "join":
        this.pluck(NOTE(76), t, 0.25, out);
        this.pluck(NOTE(83), t + 0.08, 0.2, out);
        break;
      case "sting":
        [60, 64, 67, 72].forEach((n, i) => this.pluck(NOTE(n), t + i * 0.09, 0.25, out));
        this.bell(NOTE(84), t + 0.36, 0.35, out);
        break;
      case "drumroll":
        for (let i = 0; i < 26; i++) this.noiseHit(t + i * 0.055, 0.05, 0.08 + i * 0.006, out, "bandpass", 900);
        break;
      case "applause":
        for (let i = 0; i < 90; i++) {
          this.noiseHit(t + Math.random() * 2.6, 0.03 + Math.random() * 0.05, 0.05 + Math.random() * 0.08, out, "bandpass", 1500 + Math.random() * 2500);
        }
        break;
      case "win":
        [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.bell(NOTE(n), t + i * 0.1, 0.35, out));
        this.play("applause");
        break;
      case "whoosh": {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.Q.value = 2;
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(4000, t + 0.5);
        const g = ctx.createGain();
        this.env(g, t, 0.25, 0.2, 0.4);
        src.connect(f).connect(g).connect(out);
        src.start(t);
        src.stop(t + 0.7);
        break;
      }
    }
  }
}
