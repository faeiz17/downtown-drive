// Offline check of the engine voice: render loops, simulate a rev sweep with the runtime crossfade, write a WAV,
// report loop-seam discontinuities, clipping and generation time; ffmpeg draws a spectrogram.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { renderLoop, RPM_POINTS } from '../../src/audio/EngineSound';

const sr = 44100;
const fakeCtx = { sampleRate: sr, createBuffer: (_c: number, len: number) => { const d = new Float32Array(len); return { length: len, duration: len / sr, getChannelData: () => d }; } } as unknown as BaseAudioContext;
const t0 = performance.now();
const loops: Record<string, Float32Array> = {};
for (const on of [true, false]) for (const rpm of RPM_POINTS) loops[`${on ? 'on' : 'off'}${rpm}`] = renderLoop(fakeCtx, rpm, on).getChannelData(0);
console.log(`generated ${Object.keys(loops).length} loops in ${(performance.now() - t0).toFixed(0)} ms`);
for (const [k, d] of Object.entries(loops)) {
  const seam = Math.abs(d[0] - d[d.length - 1]);
  let maxStep = 0;
  for (let i = 1; i < d.length; i++) maxStep = Math.max(maxStep, Math.abs(d[i] - d[i - 1]));
  console.log(`${k.padEnd(8)} len ${(d.length / sr).toFixed(2)} s  seam jump ${seam.toFixed(3)}  (max in-loop step ${maxStep.toFixed(3)})`);
}
// sweep: 2 s idle, 5 s rev up on-load to 6300, 1 s lift off (off-load) back to idle, 2 s idle
const T = 10, out = new Float32Array(T * sr);
const phase: Record<string, number> = {};
let loadMix = 0;
for (let n = 0; n < out.length; n++) {
  const t = n / sr;
  let rpm = 800, thr = 0;
  if (t > 2 && t < 7) { rpm = 800 + ((t - 2) / 5) * 5500; thr = 1; }
  else if (t >= 7 && t < 8.5) rpm = 6300 - ((t - 7) / 1.5) * 5500;
  loadMix += (thr * 0.85 - loadMix) * (10 / sr);
  let i = 0;
  while (i < RPM_POINTS.length - 2 && rpm > RPM_POINTS[i + 1]) i++;
  const x = Math.max(0, Math.min(1, (rpm - RPM_POINTS[i]) / (RPM_POINTS[i + 1] - RPM_POINTS[i])));
  const w = [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)];
  let s = 0;
  for (const [set, lvl] of [['on', Math.sqrt(loadMix)], ['off', Math.sqrt(1 - loadMix)]] as [string, number][]) {
    for (let j = 0; j < 2; j++) {
      const r = RPM_POINTS[i + j], key = set + r, d = loops[key];
      const p = (phase[key] = ((phase[key] ?? 0) + rpm / r) % d.length);
      const i0 = Math.floor(p), f = p - i0;
      s += (d[i0] * (1 - f) + d[(i0 + 1) % d.length] * f) * w[j] * lvl;
    }
  }
  const vol = 0.28 + Math.min(1, rpm / 6500) * 0.35 + loadMix * 0.3;
  out[n] = s * vol * 0.8;
}
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
console.log(`sweep peak ${peak.toFixed(2)} (clips if > 1)`);
const pcm = Buffer.alloc(44 + out.length * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + out.length * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(out.length * 2, 40);
for (let n = 0; n < out.length; n++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(out[n] * 32767))), 44 + n * 2);
writeFileSync('smoke-output/engine-sweep.wav', pcm);
execSync('ffmpeg -v error -y -i smoke-output/engine-sweep.wav -lavfi "showspectrumpic=s=1200x500:legend=1:fscale=lin:stop=2500:color=intensity" smoke-output/engine-sweep.png');
console.log('wrote smoke-output/engine-sweep.wav + .png');
