import { MOAN_FADE_S, MOAN_IN_S, MOAN_TO_WAIL_S, OWL_NOTES, owlCalls, type OwlCall, type SoundEvent, type SoundKind } from '../model/sound-schedule';

/**
 * The sounds (sound request), every one made with the Web Audio API from oscillators and noise: no audio file, so nothing to
 * license or download. Created on the first unmute only (this module is loaded then), so a silent visit costs nothing.
 *  - Ambient: a soft bed of crickets (four voices at their own pitch and rhythm) and an owl now and then (model/sound-schedule.ts).
 *  - Effects: the gravedigger's shovel and the resurrection, played as the scene's animations reach them (scene/SoundDriver.tsx).
 * All go through one master gain, which fades in over a second when sound is turned on and out when it is turned off; the context is
 * suspended when muted (after the fade) and while the tab is hidden.
 */

const AMBIENT_LEVEL = 0.32; // low enough to talk over
const EFFECTS_LEVEL = 0.7;
const FADE_IN_S = 1;
const FADE_OUT_S = 0.5;
const LOOKAHEAD_S = 0.7;

interface Cricket {
  freq: number;
  pan: number;
  pulses: number;
  spacing: number;
  period: number;
  next: number;
}

/** Development builds: every effect played, for the browser checks. */
declare global {
  interface Window {
    __repoInPeaceSoundLog?: string[];
  }
}

export class SoundEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly ambient: GainNode;
  private readonly effects: GainNode;
  private readonly noise: AudioBuffer;
  private readonly crickets: Cricket[];
  private readonly owl: OwlCall[];
  private owlIndex = 0;
  private nextOwl = 0;
  private timer: number | undefined;
  private on = false;
  private suspendTimer: number | undefined;
  private readonly moans = new Map<string, { gain: GainNode; oscs: OscillatorNode[]; sources: AudioScheduledSourceNode[]; drift: number }>();

  constructor() {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
    this.ambient = this.gain(AMBIENT_LEVEL, this.master);
    this.effects = this.gain(EFFECTS_LEVEL, this.master);
    // Two seconds of white noise, the source of every crunch, scatter, thud and rumble.
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.crickets = [0, 1, 2, 3].map((i) => ({
      freq: 4300 + i * 260 + Math.random() * 120,
      pan: -0.7 + i * 0.45 + Math.random() * 0.1,
      pulses: 3 + (i % 3),
      spacing: 0.045 + Math.random() * 0.015,
      period: 0.7 + i * 0.23 + Math.random() * 0.2,
      next: 0.2 + i * 0.31,
    }));
    this.owl = owlCalls(200, `repo-in-peace/owl/${Math.floor(Math.random() * 1e9)}`);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  setOn(on: boolean): void {
    this.on = on;
    window.clearTimeout(this.suspendTimer);
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (on) {
      if (document.visibilityState !== 'hidden') void this.ctx.resume();
      g.linearRampToValueAtTime(1, now + FADE_IN_S);
      if (this.nextOwl === 0) this.nextOwl = now + (this.owl[0]?.delay ?? 30);
      if (this.timer === undefined) this.timer = window.setInterval(() => this.scheduleAmbient(), 200);
      this.scheduleAmbient();
    } else {
      g.linearRampToValueAtTime(0, now + FADE_OUT_S);
      this.suspendTimer = window.setTimeout(() => {
        if (!this.on) {
          window.clearInterval(this.timer);
          this.timer = undefined;
          void this.ctx.suspend();
        }
      }, (FADE_OUT_S + 0.1) * 1000);
    }
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') void this.ctx.suspend();
    else if (this.on) void this.ctx.resume();
  };

  /** Plays one of the scene's sounds now. */
  play(event: SoundEvent, pan = 0): void {
    if (!this.on || this.ctx.state !== 'running') return;
    if (import.meta.env.DEV) (window.__repoInPeaceSoundLog ??= []).push(event.kind);
    const t = this.ctx.currentTime + 0.01;
    const out = this.panner(pan, this.effects);
    const play: Record<SoundKind, () => void> = {
      thrust: () => this.thrust(t, out),
      toss: () => this.toss(t, out),
      pat: () => this.pat(t, out),
      stake: () => this.stake(t, out),
      wail: () => this.wail(t, event.length ?? 2, out),
      rumble: () => this.rumble(t, event.length ?? 0.5, out),
      thunk: () => this.thunk(t, out),
    };
    play[event.kind]();
  }

  // ---- The ghost's moan, while its Resurrect request runs ----

  /**
   * A low, trembling moan: a soft hum (triangle and sine near 150 Hz) wavering in pitch at the shiver's pace and drifting slowly up and
   * down, with a breathy edge of band-passed noise, swelling in with the shiver. Loops, a little different all the time, until
   * `riseMoan` or `fadeMoan`.
   */
  startMoan(path: string, pan = 0): void {
    if (!this.on || this.moans.has(path)) return;
    if (import.meta.env.DEV) (window.__repoInPeaceSoundLog ??= []).push('moan');
    const t = this.ctx.currentTime + 0.01;
    const base = 138 + Math.random() * 24;
    const out = this.filter('lowpass', 1300, 0.6, this.panner(pan, this.effects));
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16, t + MOAN_IN_S + 0.2);
    gain.connect(out);
    // The waver: a slow swell of the loudness.
    const swell = this.ctx.createGain();
    swell.gain.value = 1;
    swell.connect(gain);
    const swellLfo = this.ctx.createOscillator();
    swellLfo.frequency.value = 0.55 + Math.random() * 0.3;
    const swellDepth = this.ctx.createGain();
    swellDepth.gain.value = 0.35;
    swellDepth.connect(swell.gain);
    swellLfo.connect(swellDepth);
    // The tremble: a fast, small wobble of the pitch, in time with the shiver.
    const tremble = this.ctx.createOscillator();
    tremble.frequency.value = 5.6 + Math.random() * 0.8;
    const trembleDepth = this.ctx.createGain();
    trembleDepth.gain.value = base * 0.025;
    tremble.connect(trembleDepth);
    const oscs = (['triangle', 'sine'] as const).map((type, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(base * (i === 0 ? 1 : 2.007), t);
      trembleDepth.connect(osc.frequency);
      osc.connect(this.gain(i === 0 ? 0.6 : 0.3, swell));
      return osc;
    });
    // The breath: noise through a band-pass, quieter than the hum.
    const breath = this.ctx.createBufferSource();
    breath.buffer = this.noise;
    breath.loop = true;
    breath.connect(this.filter('bandpass', 700, 1.1, this.gain(0.09, swell)));
    const sources: AudioScheduledSourceNode[] = [...oscs, swellLfo, tremble, breath];
    for (const src of sources) src.start(t);
    // A little different all the time: the pitch drifts to a new nearby note every second or so.
    const drift = window.setInterval(() => {
      const now = this.ctx.currentTime;
      const to = base * (0.92 + Math.random() * 0.16);
      oscs.forEach((osc, i) => osc.frequency.setTargetAtTime(to * (i === 0 ? 1 : 2.007), now, 0.4));
    }, 1100 + Math.random() * 500);
    this.moans.set(path, { gain, oscs, sources, drift });
  }

  /** The request opened: the moan glides up to where the wail starts and hands over to it. */
  riseMoan(path: string): void {
    const m = this.end(path, 'moan-rise');
    if (!m) return;
    const t = this.ctx.currentTime;
    m.oscs.forEach((osc, i) => {
      osc.frequency.cancelScheduledValues(t);
      osc.frequency.setValueAtTime(osc.frequency.value, t);
      osc.frequency.exponentialRampToValueAtTime(260 * (i === 0 ? 1 : 2.01), t + MOAN_TO_WAIL_S);
    });
    this.release(m, MOAN_TO_WAIL_S);
  }

  /** The request failed or was given up: the moan fades out as the shiver stops. */
  fadeMoan(path: string): void {
    const m = this.end(path, 'moan-fade');
    if (m) this.release(m, MOAN_FADE_S);
  }

  private end(path: string, log: string) {
    const m = this.moans.get(path);
    if (!m) return undefined;
    this.moans.delete(path);
    window.clearInterval(m.drift);
    if (import.meta.env.DEV) (window.__repoInPeaceSoundLog ??= []).push(log);
    return m;
  }

  private release(m: { gain: GainNode; sources: AudioScheduledSourceNode[] }, seconds: number): void {
    const t = this.ctx.currentTime;
    m.gain.gain.cancelScheduledValues(t);
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(0, t + seconds);
    for (const src of m.sources) src.stop(t + seconds + 0.05);
  }

  // ---- Ambient ----

  private scheduleAmbient(): void {
    if (!this.on || this.ctx.state !== 'running') return;
    const horizon = this.ctx.currentTime + LOOKAHEAD_S;
    for (const c of this.crickets) {
      if (c.next < this.ctx.currentTime) c.next = this.ctx.currentTime + 0.05;
      while (c.next < horizon) {
        this.chirp(c, c.next);
        // Each voice keeps its own rhythm, a little loose, and now and then rests.
        c.next += c.period * (0.85 + Math.random() * 0.3) + (Math.random() < 0.12 ? 1.5 + Math.random() * 2 : 0);
      }
    }
    if (this.nextOwl > 0 && this.nextOwl < horizon) {
      const call = this.owl[this.owlIndex % this.owl.length]!;
      this.hoot(this.nextOwl, call);
      this.owlIndex++;
      this.nextOwl += this.owl[this.owlIndex % this.owl.length]!.delay;
    }
  }

  private chirp(c: Cricket, at: number): void {
    const out = this.panner(c.pan, this.ambient);
    for (let i = 0; i < c.pulses; i++) {
      const t = at + i * c.spacing;
      const osc = this.ctx.createOscillator();
      osc.frequency.value = c.freq * (1 + (Math.random() - 0.5) * 0.01);
      const g = this.envelope(t, 0.004, 0.022, 0.05 + Math.random() * 0.02, out);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 0.04);
    }
  }

  private hoot(at: number, call: OwlCall): void {
    const out = this.panner(call.pan, this.ambient);
    const lowpass = this.filter('lowpass', 900, 0.7, out);
    for (const note of OWL_NOTES) {
      const t = at + note.at;
      const osc = this.ctx.createOscillator();
      const base = 370 * call.pitch;
      osc.frequency.setValueAtTime(base * 1.04, t);
      osc.frequency.exponentialRampToValueAtTime(base * 0.9, t + note.length);
      const g = this.envelope(t, 0.07, note.length, 0.28, lowpass);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + note.length + 0.1);
    }
  }

  // ---- Effects ----

  /** The blade biting into earth: a crunch of band-passed noise over a low thump, a little different each time. */
  private thrust(t: number, out: AudioNode): void {
    const vary = 0.85 + Math.random() * 0.3;
    this.noiseBurst(t, 0.14 * vary, 'bandpass', 650 * vary, 1.2, 0.9, out);
    this.noiseBurst(t + 0.01, 0.08, 'highpass', 2400, 0.7, 0.25, out);
    this.tone(t, 'sine', 120 * vary, 55, 0.12, 0.6, out);
  }

  /** Soil falling: a scatter of small, bright grains over about a third of a second. */
  private toss(t: number, out: AudioNode): void {
    const grains = 7 + Math.floor(Math.random() * 5);
    for (let i = 0; i < grains; i++) {
      const at = t + 0.12 + Math.random() * 0.32;
      this.noiseBurst(at, 0.015 + Math.random() * 0.02, 'bandpass', 1800 + Math.random() * 2200, 1.5, 0.12 + Math.random() * 0.12, out);
    }
  }

  /** The shovel's back on the mound: a dull thud. */
  private pat(t: number, out: AudioNode): void {
    this.noiseBurst(t, 0.09, 'lowpass', 320, 0.8, 0.9, out);
    this.tone(t, 'sine', 85, 50, 0.14, 0.7, out);
  }

  /** The stake knocked in: a short wooden knock. */
  private stake(t: number, out: AudioNode): void {
    this.tone(t, 'triangle', 540, 500, 0.09, 0.45, out);
    this.tone(t, 'sine', 1240, 1180, 0.05, 0.2, out);
    this.noiseBurst(t, 0.02, 'bandpass', 3000, 2, 0.15, out);
  }

  /** The ghost's wail: a breathy voice rising in pitch, with a slow vibrato, swelling then fading out with it. */
  private wail(t: number, length: number, out: AudioNode): void {
    const voice = this.filter('bandpass', 900, 3, out);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.35);
    g.gain.setValueAtTime(0.32, t + length * 0.45);
    g.gain.linearRampToValueAtTime(0, t + length);
    g.connect(voice);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = this.ctx.createGain();
    depth.gain.value = 14;
    lfo.connect(depth);
    for (const [type, mult, level] of [['sawtooth', 1, 0.35], ['sine', 2.01, 0.5]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(260 * mult, t);
      osc.frequency.exponentialRampToValueAtTime(720 * mult, t + length);
      depth.connect(osc.frequency);
      const lv = this.gain(level, g);
      osc.connect(lv);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
    lfo.start(t);
    lfo.stop(t + length + 0.05);
  }

  /** The stone forming: a low rumble that swells. */
  private rumble(t: number, length: number, out: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lowpass = this.filter('lowpass', 110, 0.9, out);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.1, t + length);
    g.gain.linearRampToValueAtTime(0, t + length + 0.1);
    src.connect(g).connect(lowpass);
    src.start(t);
    src.stop(t + length + 0.15);
  }

  /** The stone standing: a solid, low thunk. */
  private thunk(t: number, out: AudioNode): void {
    this.tone(t, 'sine', 95, 42, 0.35, 0.9, out);
    this.noiseBurst(t, 0.07, 'lowpass', 600, 0.7, 0.6, out);
  }

  // ---- Building blocks ----

  private gain(value: number, to: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(to);
    return g;
  }

  private panner(pan: number, to: AudioNode): AudioNode {
    if (typeof this.ctx.createStereoPanner !== 'function') return to;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(to);
    return p;
  }

  private filter(type: BiquadFilterType, freq: number, q: number, to: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(to);
    return f;
  }

  /** A gain that rises over `attack`, then falls to silence by `length`. */
  private envelope(t: number, attack: number, length: number, peak: number, to: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(length, attack + 0.005));
    g.connect(to);
    return g;
  }

  private noiseBurst(t: number, length: number, type: BiquadFilterType, freq: number, q: number, peak: number, to: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.filter(type, freq, q, to);
    src.connect(this.envelope(t, 0.004, length, peak, f));
    src.start(t, Math.random() * 1.5);
    src.stop(t + length + 0.02);
  }

  private tone(t: number, type: OscillatorType, from: number, to: number, length: number, peak: number, out: AudioNode): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + length);
    osc.connect(this.envelope(t, 0.004, length, peak, out));
    osc.start(t);
    osc.stop(t + length + 0.02);
  }
}
