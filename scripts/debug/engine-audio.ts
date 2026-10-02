/**
 * Renders the real engine voice (EngineSound, sample bank and all) offline in Chrome through a scripted drive:
 * idle, launch through the gears, rev limiter, lift-off (blow-off + crackle), nitrous. Writes a WAV and a
 * spectrogram so the sound can be checked without a speaker.
 *   npx tsx scripts/debug/engine-audio.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { withGame } from '../shot';

const code = `(async () => {
  const { EngineSound, loadEngineBank, loadBuffer } = await import('/src/audio/EngineSound.ts');
  const SR = 44100, T = 26;
  const ctx = new OfflineAudioContext(1, SR * T, SR);
  const noise = ctx.createBuffer(1, SR * 3, SR);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const [bank, backfire, nitro] = await Promise.all([loadEngineBank(ctx, '/'), loadBuffer(ctx, '/audio/backfire.wav'), loadBuffer(ctx, '/audio/nitro.wav')]);
  const eng = new EngineSound(ctx, ctx.destination, noise, bank, { backfire, nitro });
  // scripted drive: [time, rpm, throttle, boost, nitro, limiting]
  const ratios = [3.1, 2.05, 1.5, 1.17, 0.94, 0.73];
  let rpm = 950, gear = 0, shiftCount = 0, boost = 0;
  const step = 0.01;
  const log = [];
  for (let t = step; t < T; t += step) {
    await ctx.suspend(t);
    let throttle = 0, nit = false, limiting = false;
    if (t < 2) { rpm += (950 - rpm) * 0.1; }
    else if (t < 14.5) {
      throttle = 1;
      if (gear === 0 && rpm < 4700) rpm += 5200 * step * 2; // launch flare
      rpm += (2600 / (1 + gear * 0.9)) * step;
      if (rpm > 7350 && gear < 5) { rpm *= ratios[gear + 1] / ratios[gear]; gear++; shiftCount++; }
      if (gear === 5 && rpm > 7900) { rpm = 7900 - Math.random() * 120; limiting = true; }
    } else if (t < 17.5) { rpm += (2200 - rpm) * step * 0.9; }
    else if (t < 22.5) { throttle = 1; nit = t > 18.2; rpm = Math.min(7700, rpm + 1500 * step); }
    else { rpm += (1000 - rpm) * step * 1.4; }
    boost += ((throttle * Math.min(1, Math.max(0, (rpm - 1800) / 2200))) - boost) * Math.min(1, (throttle ? 5 : 7) * step);
    eng.update(step, { rpm, redline: 7600, throttle, load: throttle ? 0.9 : -0.2, boost, nitro: nit, limiting, shiftCount, interior: false }, 1);
    if (Math.round(t / step) % 50 === 0) log.push([t.toFixed(1), Math.round(rpm), gear + 1].join(':'));
    ctx.resume();
  }
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i])); sum += d[i] * d[i]; }
  const pcm = new Int16Array(d.length);
  for (let i = 0; i < d.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(d[i] * 32767)));
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), peak, rms: Math.sqrt(sum / d.length), log: log.join(' '), loops: bank.loops.map((l) => l.hz) };
})()`;

mkdirSync('smoke-output', { recursive: true });
const { result, errors } = await withGame(async (open) => {
  const page = await open('capture&autoplay&quality=low', 640, 360, 1);
  return page.evaluate(code);
});
const r = result as { b64: string; peak: number; rms: number; log: string; loops: number[] };
const pcm = Buffer.from(r.b64, 'base64');
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(44100, 24);
header.writeUInt32LE(88200, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
writeFileSync('smoke-output/engine.wav', Buffer.concat([header, pcm]));
execSync('ffmpeg -v error -y -i smoke-output/engine.wav -lavfi "showspectrumpic=s=1800x620:legend=1:scale=log:fscale=log:start=25:stop=12000:gain=4" smoke-output/engine-spectrogram.png');
console.log(`peak ${r.peak.toFixed(2)} rms ${r.rms.toFixed(3)} loops(Hz) ${r.loops.join(',')}`);
console.log(r.log);
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 6).join('\n') || 'no console errors');
