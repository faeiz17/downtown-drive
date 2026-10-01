// Procedural engine voice for the Lancer's 1.6 L inline-4 (4G18).
// Instead of raw oscillators (which buzz like a synth), short loops are synthesised from simulated combustion
// pulses: 4 cylinders firing evenly every 180° of crank, each pulse exciting exhaust resonances, with small
// cylinder-to-cylinder differences that give the characteristic "throb". Loops are rendered at several rpm points,
// on-load and off-load, then crossfaded (equal power) and pitched with playbackRate at runtime. Adds induction roar,
// overrun crackle and an in-cabin (muffled) variant.

export const RPM_POINTS = [800, 1500, 2500, 3600, 4800, 6300];

interface LoopSet {
  src: AudioBufferSourceNode[];
  gain: GainNode[];
}

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Render one seamless loop of engine sound at a fixed rpm. */
export function renderLoop(ctx: BaseAudioContext, rpm: number, onLoad: boolean): AudioBuffer {
  const sr = ctx.sampleRate;
  const cycle = 120 / rpm; // one 4-stroke cycle = 2 crank revolutions
  const nCycles = Math.max(6, Math.round(0.9 / cycle));
  const len = Math.round(nCycles * cycle * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const rnd = mulberry(Math.round(rpm) * (onLoad ? 7 : 13));
  // per-cylinder character (firing order 1-3-4-2, even 180° spacing)
  const cylAmp = [1.0, 0.9, 1.07, 0.95];
  const cylTone = [1.0, 1.04, 0.97, 1.02];
  const interval = cycle / 4;
  const tau = Math.min(interval * 0.55, onLoad ? 0.0065 : 0.0045); // pulse decay
  const f1 = 115 + rpm * 0.006; // exhaust "boom" resonance
  const f2 = 380 + rpm * 0.02; // pipe / muffler resonance
  const f3 = 1150; // tailpipe rasp
  const ampLoad = onLoad ? 1 : 0.55;
  const pulseLen = Math.min(Math.round(tau * 6 * sr), len);
  const noise = new Float32Array(pulseLen);
  for (let c = 0; c < nCycles; c++) {
    for (let k = 0; k < 4; k++) {
      const jitter = (rnd() - 0.5) * interval * 0.02;
      const start = (c * cycle + k * interval + jitter) * sr;
      const a = cylAmp[k] * ampLoad * (0.92 + rnd() * 0.16);
      for (let i = 0; i < pulseLen; i++) noise[i] = rnd() * 2 - 1;
      const s0 = Math.floor(start);
      for (let i = 0; i < pulseLen; i++) {
        const t = i / sr;
        const env = Math.exp(-t / tau);
        const envN = Math.exp(-t / (tau * 0.45));
        const v =
          env * (0.65 * Math.sin(2 * Math.PI * f1 * cylTone[k] * t) + 0.32 * Math.sin(2 * Math.PI * f2 * cylTone[k] * t) + (onLoad ? 0.12 : 0.05) * Math.sin(2 * Math.PI * f3 * t)) +
          envN * noise[i] * (onLoad ? 0.35 : 0.2) +
          (i < 3 ? (onLoad ? 0.5 : 0.25) : 0); // sharp combustion transient
        d[(((s0 + i) % len) + len) % len] += a * v;
      }
    }
  }
  // exhaust system: one-pole low-pass (brighter on load), DC blocker; wrap-aware by running two passes
  const cutoff = onLoad ? 3200 : 1500;
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  let lp = 0, hpIn = 0, hpOut = 0;
  const hpA = Math.exp((-2 * Math.PI * 28) / sr);
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < len; i++) {
      lp += (d[i] - lp) * alpha;
      const y = hpA * (hpOut + lp - hpIn);
      hpIn = lp;
      hpOut = y;
      if (pass === 1) d[i] = y;
    }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  const g = 0.9 / (peak || 1);
  for (let i = 0; i < len; i++) d[i] *= g;
  return buf;
}

export class EngineSound {
  private on: LoopSet;
  private off: LoopSet;
  private out: GainNode;
  private cabin: BiquadFilterNode;
  private intake: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private loadMix = 0;
  private lastThrottle = 0;
  private crackleUntil = 0;
  private nextCrackle = 0;

  constructor(private ctx: AudioContext, dest: AudioNode, private noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.cabin = ctx.createBiquadFilter();
    this.cabin.type = 'lowpass';
    this.cabin.frequency.value = 6000;
    this.cabin.Q.value = 0.5;
    this.out.connect(this.cabin).connect(dest);
    this.on = this.makeSet(true);
    this.off = this.makeSet(false);
    // induction roar
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.cabin);
    src.start();
    this.intake = { src, filter, gain };
  }

  private makeSet(onLoad: boolean): LoopSet {
    const set: LoopSet = { src: [], gain: [] };
    for (const rpm of RPM_POINTS) {
      const src = this.ctx.createBufferSource();
      src.buffer = renderLoop(this.ctx, rpm, onLoad);
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.out);
      // de-phase the loops so crossfades don't comb-filter
      src.start(0, Math.random() * src.buffer.duration);
      set.src.push(src);
      set.gain.push(g);
    }
    return set;
  }

  /** rpm, throttle 0..1, load −1..1 (engine torque), interior camera (muffled), master level 0..1 */
  update(dt: number, rpm: number, throttle: number, load: number, interior: boolean, level: number): void {
    const t = this.ctx.currentTime;
    const tc = 0.03;
    // find neighbouring rpm points and equal-power crossfade weights
    let i = 0;
    while (i < RPM_POINTS.length - 2 && rpm > RPM_POINTS[i + 1]) i++;
    const r0 = RPM_POINTS[i], r1 = RPM_POINTS[i + 1];
    const x = Math.max(0, Math.min(1, (rpm - r0) / (r1 - r0)));
    const w0 = Math.cos((x * Math.PI) / 2), w1 = Math.sin((x * Math.PI) / 2);
    const target = Math.max(0, Math.min(1, throttle * 0.85 + Math.max(0, load) * 0.35));
    this.loadMix += (target - this.loadMix) * Math.min(1, dt * 10);
    const onL = Math.sqrt(this.loadMix), offL = Math.sqrt(1 - this.loadMix);
    for (const [set, lvl] of [[this.on, onL], [this.off, offL]] as [LoopSet, number][]) {
      for (let k = 0; k < RPM_POINTS.length; k++) {
        const w = k === i ? w0 : k === i + 1 ? w1 : 0;
        set.gain[k].gain.setTargetAtTime(w * lvl, t, tc);
        if (w > 0.001) set.src[k].playbackRate.setTargetAtTime(rpm / RPM_POINTS[k], t, 0.015);
      }
    }
    // overall level: louder with rpm and throttle; cabin muffles highs
    const rpmN = Math.min(1, rpm / 6500);
    const vol = (0.28 + rpmN * 0.35 + this.loadMix * 0.3) * level * (interior ? 0.75 : 1);
    this.out.gain.setTargetAtTime(vol, t, 0.05);
    this.cabin.frequency.setTargetAtTime(interior ? 1300 + rpmN * 900 : 7000, t, 0.1);
    this.intake.gain.gain.setTargetAtTime(throttle * (0.03 + rpmN * 0.08) * level, t, 0.05);
    this.intake.filter.frequency.setTargetAtTime(350 + rpm * 0.35, t, 0.05);
    // overrun crackle: lifting off sharply at high rpm pops the exhaust for a moment
    if (this.lastThrottle > 0.7 && throttle < 0.1 && rpm > 3800) this.crackleUntil = t + 0.5 + Math.random() * 0.4;
    this.lastThrottle = throttle;
    if (t < this.crackleUntil && t > this.nextCrackle && !interior) {
      this.pop(0.08 + Math.random() * 0.12, level);
      this.nextCrackle = t + 0.04 + Math.random() * 0.1;
    }
  }

  private pop(vol: number, level: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700 + Math.random() * 900;
    f.Q.value = 1.2;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(vol * level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.cabin);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.07);
  }
}
