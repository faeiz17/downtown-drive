// Game audio (Web Audio API). The engine, tyre squeal, exhaust bangs, nitrous, rain and thunder are real recordings
// (CC0, credited in the README); wind, road roar, wet-road spray, turbo, horn and impacts are synthesised.
import type { Settings } from '../core/Settings';
import { EngineSound, loadBuffer, loadEngineBank } from './EngineSound';

function noiseBuffer(ctx: AudioContext, seconds: number, brown = false): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

export interface EngineState {
  rpm: number;
  redline: number;
  throttle: number; // 0..1 effective
  load: number; // −1..1 (engine torque normalised)
  boost: number; // turbo 0..1
  nitro: boolean;
  limiting: boolean;
  shiftCount: number;
  speed: number; // ground speed m/s
  slip: number; // tyre slip (0 .. >1)
  skid: number; // how fast the worst tyre is sliding over the road (m/s)
  surfaceGrass: boolean;
  horn: boolean;
  indicatorTick: boolean;
  reversing: boolean;
  interior: boolean; // cockpit camera: everything outside is muffled
}

export interface AmbientState {
  night: number;
  nearMajorRoad: number;
  trafficNear: number;
  /** 0..1 rain falling, 0..1 road wetness */
  rain: number;
  wet: number;
}

interface NoiseVoice {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private engineBus: GainNode;
  private sfxBus: GainNode;
  private ambientBus: GainNode;
  private engine: EngineSound | null = null;
  private squeal: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private rain: NoiseVoice | null = null;
  private thunder: AudioBuffer | null = null;
  private nextThunder = 12;
  private squealLevel = 0;
  private road: NoiseVoice;
  private wind: NoiseVoice;
  private spray: NoiseVoice;
  // horn
  private horn: { oscs: OscillatorNode[]; gain: GainNode };
  private hornOn = false;
  private reverseBeepT = 0;
  // ambience
  private ambient: NoiseVoice;
  private nextHonk = 6;
  private nextBird = 1;
  private crickets: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode };
  private noise: AudioBuffer;
  started = false;
  /** true once the recorded samples are decoded */
  ready = false;

  constructor(private settings: Settings) {
    const AC: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambientBus = ctx.createGain();
    for (const b of [this.engineBus, this.sfxBus, this.ambientBus]) b.connect(this.master);
    this.noise = noiseBuffer(ctx, 3);
    const brown = noiseBuffer(ctx, 4, true);

    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    this.road = this.loopNoise(brown, 'lowpass', 400, 0, this.sfxBus);
    this.wind = this.loopNoise(this.noise, 'bandpass', 700, 0, this.sfxBus, 0.5);
    this.spray = this.loopNoise(this.noise, 'bandpass', 2600, 0, this.sfxBus, 0.6);

    // --- horn: dual tone (~420/520 Hz), slightly overdriven
    const hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    const hornShape = ctx.createWaveShaper();
    hornShape.curve = curve;
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'bandpass';
    hornFilter.frequency.value = 900;
    hornFilter.Q.value = 0.7;
    hornShape.connect(hornFilter).connect(hornGain).connect(this.sfxBus);
    const hornOscs = [420, 523].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hornShape);
      o.start();
      return o;
    });
    this.horn = { oscs: hornOscs, gain: hornGain };

    // --- ambience: brown-noise city bed + night crickets
    this.ambient = this.loopNoise(brown, 'lowpass', 600, 0.1, this.ambientBus);
    const cricket = ctx.createOscillator();
    cricket.frequency.value = 4400;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    const cg = ctx.createGain();
    cg.gain.value = 0;
    const cgMod = ctx.createGain();
    cgMod.gain.value = 0.5;
    lfo.connect(lfoGain).connect(cgMod.gain);
    cricket.connect(cgMod).connect(cg).connect(this.ambientBus);
    cricket.start();
    lfo.start();
    this.crickets = { osc: cricket, lfo, gain: cg };
    this.applyVolumes();
  }

  /** Load the recorded samples (engine loop bank, squeal, backfire, nitrous, rain, thunder). */
  async load(base: string): Promise<void> {
    const ctx = this.ctx;
    const [bank, squeal, backfire, nitro, rain, thunder] = await Promise.all([
      loadEngineBank(ctx, base),
      loadBuffer(ctx, `${base}audio/squeal.wav`),
      loadBuffer(ctx, `${base}audio/backfire.wav`),
      loadBuffer(ctx, `${base}audio/nitro.wav`),
      loadBuffer(ctx, `${base}audio/rain.wav`),
      loadBuffer(ctx, `${base}audio/thunder.wav`),
    ]);
    this.engine = new EngineSound(ctx, this.engineBus, this.noise, bank, { backfire, nitro });
    const sq = ctx.createBufferSource();
    sq.buffer = squeal;
    sq.loop = true;
    const sqGain = ctx.createGain();
    sqGain.gain.value = 0;
    sq.connect(sqGain).connect(this.sfxBus);
    sq.start();
    this.squeal = { src: sq, gain: sqGain };
    this.rain = this.loopNoise(rain, 'lowpass', 9000, 0, this.ambientBus, 0.5);
    this.thunder = thunder;
    this.ready = true;
  }

  private loopNoise(buf: AudioBuffer, type: BiquadFilterType, freq: number, gain: number, bus: AudioNode, q = 1): NoiseVoice {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(bus);
    src.start();
    return { src, filter, gain: g };
  }

  applyVolumes(): void {
    const s = this.settings;
    this.master.gain.value = s.masterVolume;
    this.engineBus.gain.value = s.engineVolume;
    this.sfxBus.gain.value = s.sfxVolume;
    this.ambientBus.gain.value = s.ambientVolume;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.started = true;
  }

  suspend(): void {
    if (this.ctx.state === 'running') this.ctx.suspend();
  }

  update(dt: number, e: EngineState, env: AmbientState): void {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const ramp = (p: AudioParam, v: number, tc = 0.04) => p.setTargetAtTime(v, t, tc);
    const out = e.interior ? 0.55 : 1; // how much of the outside world gets into the cabin
    this.engine?.update(dt, e, 1);
    // tyres: recorded squeal on dry tarmac, pitched by how fast the rubber slides. A wet road hisses instead.
    const sliding = e.surfaceGrass ? 0 : Math.max(0, Math.min(1, (e.slip - 1.0) * 1.3)) * Math.min(1, e.speed / 5);
    this.squealLevel += (sliding - this.squealLevel) * Math.min(1, dt * (sliding > this.squealLevel ? 16 : 7));
    if (this.squeal) {
      ramp(this.squeal.gain.gain, this.squealLevel * this.squealLevel * 0.5 * (1 - 0.8 * env.wet) * out, 0.03);
      ramp(this.squeal.src.playbackRate, 0.82 + Math.min(0.45, e.skid * 0.022), 0.08);
    }
    // road roar (tyres on tarmac / grass), wind, and spray thrown up on a wet road
    ramp(this.road.gain.gain, Math.min(0.55, e.speed / 55) * (e.surfaceGrass ? 0.9 : 0.4));
    ramp(this.road.filter.frequency, e.surfaceGrass ? 900 : 260 + e.speed * 7);
    const w = Math.min(1, e.speed / 85);
    ramp(this.wind.gain.gain, w * w * 0.5 * (e.interior ? 0.5 : 1));
    ramp(this.wind.filter.frequency, 500 + w * 1500);
    ramp(this.spray.gain.gain, env.wet * (Math.min(1, e.speed / 45) * 0.11 + this.squealLevel * 0.2) * out);
    ramp(this.spray.filter.frequency, 1800 + Math.min(1, e.speed / 60) * 2600);
    // horn
    if (e.horn !== this.hornOn) {
      this.hornOn = e.horn;
      ramp(this.horn.gain.gain, e.horn ? 0.22 : 0, 0.01);
    }
    if (e.indicatorTick) this.click(0.08);
    if (e.reversing) {
      this.reverseBeepT -= dt;
      if (this.reverseBeepT <= 0) {
        this.beep(1400, 0.12, 0.035);
        this.reverseBeepT = 0.7;
      }
    }
    // ambience: city bed, rain (louder as the car drives into it), thunder, crickets on dry nights, birds on dry days
    ramp(this.ambient.gain.gain, (0.05 + env.nearMajorRoad * 0.12 + env.trafficNear * 0.05) * (1 - env.night * 0.4), 0.5);
    if (this.rain) {
      ramp(this.rain.gain.gain, env.rain * (0.55 + Math.min(0.35, e.speed / 120)), 0.4);
      ramp(this.rain.filter.frequency, e.interior ? 1700 : 9000, 0.2);
    }
    if (this.thunder && env.rain > 0.5) {
      this.nextThunder -= dt;
      if (this.nextThunder <= 0) {
        this.playThunder();
        this.nextThunder = 22 + Math.random() * 45;
      }
    }
    ramp(this.crickets.gain.gain, env.night * (1 - env.rain) * 0.01, 1);
    this.nextHonk -= dt;
    if (this.nextHonk <= 0) {
      this.distantHonk(0.2 + env.nearMajorRoad * 0.5);
      this.nextHonk = 9 + Math.random() * (env.night > 0.5 ? 30 : 16);
    }
    this.nextBird -= dt;
    if (this.nextBird <= 0 && env.night < 0.3 && env.rain < 0.2) {
      this.bird();
      this.nextBird = 3 + Math.random() * 8;
    }
  }

  private envGain(peak: number, attack: number, hold: number, release: number): GainNode {
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  private playThunder(): void {
    const s = this.ctx.createBufferSource();
    s.buffer = this.thunder;
    s.playbackRate.value = 0.8 + Math.random() * 0.3;
    const g = this.ctx.createGain();
    g.gain.value = 0.3 + Math.random() * 0.4;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    s.connect(g).connect(p).connect(this.ambientBus);
    s.start();
  }

  click(vol: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2500;
    f.Q.value = 3;
    const g = this.envGain(vol, 0.001, 0.005, 0.03);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start();
    src.stop(this.ctx.currentTime + 0.06);
  }

  beep(freq: number, dur: number, vol: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    const g = this.envGain(vol, 0.005, dur, 0.03);
    o.connect(g).connect(this.sfxBus);
    o.start();
    o.stop(this.ctx.currentTime + dur + 0.05);
  }

  /** Air rushing past: a near miss with traffic, or a pole flashing by. strength 0..1 */
  whoosh(strength: number, pan = 0): void {
    if (this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime, s = Math.min(1, strength);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.09);
    f.frequency.exponentialRampToValueAtTime(350, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 + 0.3 * s, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f).connect(g).connect(p).connect(this.sfxBus);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.4);
  }

  /** Collision thump; strength 0..1 */
  impact(strength: number): void {
    if (this.ctx.state !== 'running') return;
    const s = Math.min(1, strength);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300 + s * 1500;
    const g = this.envGain(0.6 * s + 0.1, 0.002, 0.03, 0.35 + s * 0.4);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start();
    src.stop(this.ctx.currentTime + 1);
    // metallic ring
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 180 + Math.random() * 120;
    const og = this.envGain(0.15 * s, 0.002, 0.02, 0.4);
    o.connect(og).connect(this.sfxBus);
    o.start();
    o.stop(this.ctx.currentTime + 0.6);
  }

  /** Honk from an AI vehicle at a given distance/pan. */
  aiHonk(distance: number, pan: number, kind: string): void {
    if (this.ctx.state !== 'running') return;
    const vol = Math.min(0.22, 5 / Math.max(6, distance));
    const freqs = kind === 'bike' ? [720] : kind === 'pickup' ? [330, 415] : [390, 490];
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    const g = this.envGain(vol, 0.01, 0.25 + Math.random() * 0.35, 0.06);
    g.connect(p).connect(this.sfxBus);
    for (const fr of freqs) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = fr;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      o.connect(lp).connect(g);
      o.start();
      o.stop(this.ctx.currentTime + 0.8);
    }
  }

  /** A honk somewhere in the city; `closeness` 0..1 (near a main road honks sound closer). */
  private distantHonk(closeness: number): void {
    this.aiHonk(70 + (1 - Math.min(1, closeness)) * 240 * Math.random(), Math.random() * 2 - 1, Math.random() < 0.25 ? 'pickup' : 'car');
  }

  private bird(): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    const t = this.ctx.currentTime;
    const base = 2200 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      o.frequency.setValueAtTime(base, t + i * 0.12);
      o.frequency.exponentialRampToValueAtTime(base * 1.4, t + i * 0.12 + 0.06);
    }
    const g = this.envGain(0.012, 0.01, n * 0.12, 0.05);
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.random() * 2 - 1;
    o.connect(g).connect(p).connect(this.ambientBus);
    o.start();
    o.stop(t + n * 0.12 + 0.1);
  }
}
