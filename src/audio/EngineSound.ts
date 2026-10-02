// Engine voice built from a real recording instead of synthesis.
//
// public/audio/engine.wav holds a bank of seamless constant-pitch loops cut from a turbocharged straight-six on a
// chassis dyno (Freesound #496171 by editboy23, CC0; see scripts/audio/build_engine_loops.py for how a rising pull
// is turned into steady loops). Each loop knows its firing frequency. At runtime the two loops nearest the wanted
// frequency play cross-faded (equal power) and are fine-tuned with playbackRate, so the timbre is always that of a
// real engine near that speed rather than one sample stretched across the whole rev range.
// On top: load-dependent tone (closed throttle is duller and quieter), a rev limiter that cuts in bursts, a dip on
// each gear change, turbo whistle and blow-off, exhaust bangs on the overrun (recorded backfire), and nitrous.
export interface EngineBank {
  loops: { buffer: AudioBuffer; hz: number }[];
}

export interface EngineInput {
  rpm: number;
  redline: number;
  throttle: number; // 0..1 effective
  load: number; // −1..1 (engine torque normalised)
  boost: number; // turbo spool 0..1
  nitro: boolean;
  limiting: boolean;
  shiftCount: number;
  interior: boolean;
}

/** Decode a PCM16 mono WAV at its own sample rate (decodeAudioData would resample it and blur the loop points). */
export async function loadWav(ctx: BaseAudioContext, url: string): Promise<{ data: Float32Array; sampleRate: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio missing: ${url}`);
  const view = new DataView(await res.arrayBuffer());
  let p = 12, sampleRate = 44100, channels = 1, dataAt = -1, dataLen = 0;
  while (p + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3));
    const size = view.getUint32(p + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(p + 10, true);
      sampleRate = view.getUint32(p + 12, true);
    } else if (id === 'data') {
      dataAt = p + 8;
      dataLen = size;
      break;
    }
    p += 8 + size + (size & 1);
  }
  if (dataAt < 0) throw new Error(`not a WAV file: ${url}`);
  const n = Math.floor(dataLen / 2 / channels);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = view.getInt16(dataAt + i * 2 * channels, true) / 32768;
  void ctx;
  return { data, sampleRate };
}

export async function loadBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const { data, sampleRate } = await loadWav(ctx, url);
  const buf = ctx.createBuffer(1, data.length, sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

export async function loadEngineBank(ctx: BaseAudioContext, base: string): Promise<EngineBank> {
  const [manifest, wav] = await Promise.all([
    fetch(`${base}audio/engine.json`).then((r) => r.json() as Promise<{ sampleRate: number; loops: { offset: number; length: number; hz: number }[] }>),
    loadWav(ctx, `${base}audio/engine.wav`),
  ]);
  const loops = manifest.loops.map((l) => {
    const buffer = ctx.createBuffer(1, l.length, wav.sampleRate);
    buffer.getChannelData(0).set(wav.data.subarray(l.offset, l.offset + l.length));
    return { buffer, hz: l.hz };
  });
  loops.sort((a, b) => a.hz - b.hz);
  return { loops };
}

/** The game's engine is mapped to a firing frequency of rpm / 30 (as a four-stroke four would fire). */
const HZ_PER_RPM = 1 / 30;

export class EngineSound {
  private src: AudioBufferSourceNode[] = [];
  private gain: GainNode[] = [];
  private tone: BiquadFilterNode;
  private out: GainNode;
  private cabin: BiquadFilterNode;
  private intake: { filter: BiquadFilterNode; gain: GainNode };
  private whistle: { filter: BiquadFilterNode; gain: GainNode; osc: OscillatorNode; oscGain: GainNode };
  private hiss: GainNode;
  private loadMix = 0;
  private lastThrottle = 0;
  private lastBoost = 0;
  private lastShift = 0;
  private wasLimiting = false;
  private wasNitro = false;
  private crackleUntil = 0;
  private nextCrackle = 0;
  private dipUntil = 0;

  constructor(private ctx: AudioContext, dest: AudioNode, private noise: AudioBuffer, private bank: EngineBank, private shots: { backfire: AudioBuffer; nitro: AudioBuffer }) {
    this.cabin = ctx.createBiquadFilter();
    this.cabin.type = 'lowpass';
    this.cabin.frequency.value = 16000;
    this.cabin.Q.value = 0.5;
    this.cabin.connect(dest);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 1200;
    this.tone.Q.value = 0.6;
    // gentle saturation: glues the two cross-fading loops together and adds bite under load
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    drive.curve = curve;
    this.tone.connect(drive).connect(this.out).connect(this.cabin);
    for (const l of bank.loops) {
      const s = ctx.createBufferSource();
      s.buffer = l.buffer;
      s.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(g).connect(this.tone);
      s.start(0, Math.random() * l.buffer.duration);
      this.src.push(s);
      this.gain.push(g);
    }
    const noiseLoop = (type: BiquadFilterType, freq: number, q: number) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      s.connect(filter).connect(gain).connect(this.cabin);
      s.start(0, Math.random() * 2);
      return { filter, gain };
    };
    this.intake = noiseLoop('bandpass', 500, 1.2);
    // turbo: a narrow band of noise plus a faint pure tone, both rising with boost
    const w = noiseLoop('bandpass', 4000, 9);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0;
    osc.connect(oscGain).connect(this.cabin);
    osc.start();
    this.whistle = { ...w, osc, oscGain };
    this.hiss = noiseLoop('highpass', 2600, 0.7).gain;
  }

  update(dt: number, e: EngineInput, level: number): void {
    const ctx = this.ctx, t = ctx.currentTime;
    const loops = this.bank.loops;
    // --- which two loops, and how far between them (in pitch, i.e. log frequency)
    const f = Math.max(22, e.rpm * HZ_PER_RPM);
    let i = 0;
    while (i < loops.length - 2 && f > loops[i + 1].hz) i++;
    const f0 = loops[i].hz, f1 = loops[i + 1].hz;
    const x = Math.max(0, Math.min(1, Math.log(f / f0) / Math.log(f1 / f0)));
    const w0 = Math.cos((x * Math.PI) / 2), w1 = Math.sin((x * Math.PI) / 2);
    for (let k = 0; k < loops.length; k++) {
      const w = k === i ? w0 : k === i + 1 ? w1 : 0;
      this.gain[k].gain.setTargetAtTime(w, t, 0.025);
      if (w > 0.001) this.src[k].playbackRate.setTargetAtTime(f / loops[k].hz, t, 0.012);
    }
    // --- load: open throttle is loud and bright, closed throttle dull and quiet
    const target = Math.max(0, Math.min(1, e.throttle * 0.8 + Math.max(0, e.load) * 0.4));
    this.loadMix += (target - this.loadMix) * Math.min(1, dt * (target > this.loadMix ? 14 : 8));
    const rpmN = Math.min(1, e.rpm / e.redline);
    let vol = (0.3 + 0.32 * rpmN + 0.42 * this.loadMix) * level;
    // rev limiter: the fuel cut is heard as a rapid stutter; gear change: a short hole in the sound
    if (e.shiftCount !== this.lastShift) {
      this.dipUntil = t + 0.075;
      if (this.loadMix > 0.5 && e.rpm > 4500 && !e.interior) this.bang(0.12 + Math.random() * 0.1, 1.3 + Math.random() * 0.5, level);
      this.lastShift = e.shiftCount;
    }
    if (e.limiting && !this.wasLimiting && !e.interior) this.bang(0.1 + Math.random() * 0.08, 1.5 + Math.random() * 0.6, level);
    this.wasLimiting = e.limiting;
    const chopped = e.limiting || t < this.dipUntil;
    if (chopped) vol *= 0.3;
    this.out.gain.setTargetAtTime(vol * (e.interior ? 0.8 : 1), t, chopped ? 0.006 : 0.03);
    this.tone.frequency.setTargetAtTime(650 + 12500 * this.loadMix * this.loadMix + 1500 * rpmN + (e.nitro ? 3000 : 0), t, 0.04);
    this.cabin.frequency.setTargetAtTime(e.interior ? 1500 + rpmN * 1100 : 16000, t, 0.1);
    this.intake.gain.gain.setTargetAtTime(this.loadMix * (0.02 + rpmN * 0.07) * level, t, 0.05);
    this.intake.filter.frequency.setTargetAtTime(320 + e.rpm * 0.3, t, 0.05);

    // --- turbo whistle, and the blow-off valve when the throttle snaps shut on boost
    const b = Math.max(0, Math.min(1, e.boost));
    const wf = 2300 + 6200 * b;
    this.whistle.filter.frequency.setTargetAtTime(wf, t, 0.05);
    this.whistle.osc.frequency.setTargetAtTime(wf, t, 0.05);
    const wl = b * b * level * (e.interior ? 0.5 : 1);
    this.whistle.gain.gain.setTargetAtTime(wl * 0.07, t, 0.05);
    this.whistle.oscGain.gain.setTargetAtTime(wl * 0.012, t, 0.05);
    if (this.lastThrottle > 0.6 && e.throttle < 0.15 && this.lastBoost > 0.45) this.blowOff((0.16 + 0.2 * this.lastBoost) * level * (e.interior ? 0.5 : 1));
    this.lastBoost += (b - this.lastBoost) * Math.min(1, dt * 12);

    // --- overrun: lifting off at high revs pops and crackles for a moment
    if (this.lastThrottle > 0.6 && e.throttle < 0.1 && e.rpm > 4300) this.crackleUntil = t + 0.45 + Math.random() * 0.6;
    this.lastThrottle = e.throttle;
    if (t < this.crackleUntil && t > this.nextCrackle && !e.interior && e.throttle < 0.2) {
      const big = Math.random() < 0.2;
      this.bang(big ? 0.16 + Math.random() * 0.12 : 0.04 + Math.random() * 0.07, big ? 1.0 + Math.random() * 0.3 : 1.6 + Math.random() * 1.0, level);
      this.nextCrackle = t + 0.05 + Math.random() * 0.16;
    }

    // --- nitrous: a purge when it opens, a hard hiss while it burns
    if (e.nitro && !this.wasNitro) this.shot(this.shots.nitro, 0.5 * level, 1, 0);
    this.wasNitro = e.nitro;
    this.hiss.gain.setTargetAtTime(e.nitro ? 0.09 * level : 0, t, e.nitro ? 0.04 : 0.15);
  }

  private shot(buffer: AudioBuffer, vol: number, rate: number, highpass: number): void {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (highpass > 0) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = highpass;
      s.connect(f).connect(g);
    } else s.connect(g);
    g.connect(this.cabin);
    s.start();
  }

  /** Exhaust bang (recorded backfire). Small fast ones are the crackle, slow loud ones the bangs. */
  private bang(vol: number, rate: number, level: number): void {
    this.shot(this.shots.backfire, vol * level, rate, rate > 1.4 ? 260 : 90);
  }

  /** Blow-off valve: a burst of air that drops in pitch and flutters. */
  private blowOff(vol: number): void {
    const ctx = this.ctx, t = ctx.currentTime, dur = 0.38;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(5200, t);
    f.frequency.exponentialRampToValueAtTime(1700, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const flutter = ctx.createGain();
    flutter.gain.value = 0.62;
    const lfo = ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.setValueAtTime(34, t);
    lfo.frequency.linearRampToValueAtTime(17, t + dur);
    const depth = ctx.createGain();
    depth.gain.value = 0.38;
    lfo.connect(depth).connect(flutter.gain);
    s.connect(f).connect(env).connect(flutter).connect(this.cabin);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.05);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
}
