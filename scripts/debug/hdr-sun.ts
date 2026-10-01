// Find the sun/moon direction and average colours of an equirect .hdr (used to line the sky up with the game's sun).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f);
  const t = new HDRLoader().setDataType(THREE.FloatType).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as { width: number; height: number; data: Float32Array };
  const { width: w, height: h, data } = t;
  let best = 0, bx = 0, by = 0, max = 0;
  const up = [0, 0, 0], hor = [0, 0, 0]; let nu = 0, nh = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    max = Math.max(max, L);
    if (L > best) { best = L; bx = x; by = y; }
    const el = 90 - (y / h) * 180, wgt = Math.cos((el * Math.PI) / 180);
    if (el > 30) { up[0] += data[i] * wgt; up[1] += data[i + 1] * wgt; up[2] += data[i + 2] * wgt; nu += wgt; }
    if (el > 0 && el < 8) { hor[0] += Math.min(50, data[i]); hor[1] += Math.min(50, data[i + 1]); hor[2] += Math.min(50, data[i + 2]); nh++; }
  }
  console.log(f.split('/').pop(), `${w}x${h}`, 'brightest u', (bx / w).toFixed(4), 'elevation', (90 - (by / h) * 180).toFixed(1), 'peak', max.toFixed(1),
    'zenith avg', up.map((v) => (v / nu).toFixed(3)).join(','), 'horizon avg', hor.map((v) => (v / nh).toFixed(3)).join(','));
}
