// Procedural audio (Web Audio API, no sample files): engine, tyres, horn, indicator, impacts, city ambience.
import type { Settings } from '../core/Settings';
import { EngineSound } from './EngineSound';

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
  throttle: number; // 0..1 effective
  load: number; // −1..1 (engine torque normalised)
  speed: number; // m/s
  slip: number; // tyre slip (0 .. >1)
  surfaceGrass: boolean;
  horn: boolean;
  indicatorTick: boolean;
  reversing: boolean;
  interior: boolean; // cockpit camera: engine muffled, cabin boom
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private engineBus: GainNode;
  private sfxBus: GainNode;
  private ambientBus: GainNode;
  // engine (sample-synthesised inline-4, see EngineSound)
  private engine: EngineSound;
  // tyres: tonal squeal (two detuned oscillators + band-passed noise) with a wandering pitch
  private squeal: { oscs: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode; noise: GainNode };
  private squealWobble = 0;
  private road: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  // horn
  private horn: { oscs: OscillatorNode[]; gain: GainNode };
  private hornOn = false;
  private reverseBeepT = 0;
  // ambience
  private ambient: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private nextHonk = 2;
  private nextBird = 1;
  private crickets: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode };
  private noise: AudioBuffer;
  started = false;

  constructor(private settings: Settings) {
    const AC: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
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
    // --- engine
    this.engine = new EngineSound(ctx, this.engineBus, this.noise);
    // --- tyre squeal
    const sqFilter = ctx.createBiquadFilter();
    sqFilter.type = 'bandpass';
    sqFilter.frequency.value = 1100;
    sqFilter.Q.value = 2.2;
    const sqGain = ctx.createGain();
    sqGain.gain.value = 0;
    sqFilter.connect(sqGain).connect(this.sfxBus);
    const sqOscs = [960, 1290, 1730].map((f, k) => {
      const o = ctx.createOscillator();
      o.type = k === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = k === 2 ? 0.25 : 0.5;
      o.connect(g).connect(sqFilter);
      o.start();
      return o;
    });
    const sqNoise = this.loopNoise(this.noise, 'bandpass', 1400, 0, sqFilter, 1.5);
    this.squeal = { oscs: sqOscs, filter: sqFilter, gain: sqGain, noise: sqNoise.gain };
    this.road = this.loopNoise(brown, 'lowpass', 400, 0, this.sfxBus);
    this.wind = this.loopNoise(this.noise, 'highpass', 900, 0, this.sfxBus);

    // --- horn: Pakistani-car dual tone (~420/520 Hz), slightly overdriven
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

    // --- ambience: brown-noise traffic bed + night crickets
    this.ambient = this.loopNoise(brown, 'lowpass', 600, 0.12, this.ambientBus);
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

  private loopNoise(buf: AudioBuffer, type: BiquadFilterType, freq: number, gain: number, bus: AudioNode, q = 1) {
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

  update(dt: number, e: EngineState, env: { night: number; nearMajorRoad: number; trafficNear: number }): void {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const ramp = (p: AudioParam, v: number, tc = 0.04) => p.setTargetAtTime(v, t, tc);
    // engine
    this.engine.update(dt, e.rpm, e.throttle, e.load, e.interior, 1);
    // tyres: tonal squeal when sliding on tarmac (pitch wanders like real rubber), rumble on grass
    const sq = e.surfaceGrass ? 0 : Math.max(0, Math.min(1, (e.slip - 1.05) * 1.1)) * Math.min(1, e.speed / 4);
    this.squealWobble += (Math.random() - 0.5) * dt * 6;
    this.squealWobble *= 1 - Math.min(1, dt * 2);
    const pitch = 1 + this.squealWobble * 0.06 + sq * 0.08;
    [960, 1290, 1730].forEach((f, k) => ramp(this.squeal.oscs[k].frequency, f * pitch, 0.03));
    ramp(this.squeal.filter.frequency, 1000 + sq * 500, 0.05);
    ramp(this.squeal.gain.gain, sq * sq * 0.16 * (e.interior ? 0.6 : 1), 0.04);
    ramp(this.squeal.noise.gain, 0.6, 0.1);
    ramp(this.road.gain.gain, Math.min(0.5, e.speed / 40) * (e.surfaceGrass ? 0.9 : 0.35));
    ramp(this.road.filter.frequency, e.surfaceGrass ? 900 : 300 + e.speed * 6);
    ramp(this.wind.gain.gain, Math.max(0, (e.speed - 12) / 50) ** 2 * 0.25);
    // horn
    if (e.horn !== this.hornOn) {
      this.hornOn = e.horn;
      ramp(this.horn.gain.gain, e.horn ? 0.22 : 0, 0.01);
    }
    if (e.indicatorTick) this.click(0.08);
    // reverse warning beep (common aftermarket fitting in Pakistan)
    if (e.reversing) {
      this.reverseBeepT -= dt;
      if (this.reverseBeepT <= 0) {
        this.beep(1400, 0.12, 0.05);
        this.reverseBeepT = 0.7;
      }
    }
    // ambience: city bed louder near main roads, crickets at night, birds by day, distant honks
    ramp(this.ambient.gain.gain, (0.05 + env.nearMajorRoad * 0.15 + env.trafficNear * 0.05) * (1 - env.night * 0.5), 0.5);
    ramp(this.crickets.gain.gain, env.night * 0.012, 1);
    this.nextHonk -= dt;
    if (this.nextHonk <= 0) {
      this.distantHonk(0.2 + env.nearMajorRoad * 0.5);
      this.nextHonk = 3 + Math.random() * (env.night > 0.5 ? 16 : 7);
    }
    this.nextBird -= dt;
    if (this.nextBird <= 0 && env.night < 0.3) {
      this.bird();
      this.nextBird = 2 + Math.random() * 6;
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
    const vol = Math.min(0.25, 6 / Math.max(6, distance));
    const freqs = kind === 'rickshaw' ? [560] : kind === 'bike' ? [720] : kind === 'pickup' ? [330, 415] : [390, 490];
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
    const kinds = ['rickshaw', 'bike', 'car', 'car', 'pickup'];
    this.aiHonk(40 + (1 - Math.min(1, closeness)) * 220 * Math.random(), Math.random() * 2 - 1, kinds[Math.floor(Math.random() * kinds.length)]);
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
    const g = this.envGain(0.015, 0.01, n * 0.12, 0.05);
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.random() * 2 - 1;
    o.connect(g).connect(p).connect(this.ambientBus);
    o.start();
    o.stop(t + n * 0.12 + 0.1);
  }
}
