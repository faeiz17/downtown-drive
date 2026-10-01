// Procedural infill: OSM only maps ~1.1k of Gulberg's buildings, so plots are generated along streets where the
// occupancy raster is free. Residential streets get kothi plots (house + boundary wall + gate); main roads get plazas.
import type { Stroke } from '../../src/data/types';
import { PLOT_STRIDE } from '../../src/data/types';
import { RNG, hash32 } from '../../src/core/rng';
import { cumulative, sampleAt, leftNormal, pointInPolygon } from '../../src/core/geom2d';
import { Raster, PLOT } from './raster';
import { round1 } from './roads';

const COMMERCIAL_NAMES = /mm alam|m\.m\. alam|main market|main boulevard|liberty|mini market|commercial|firdous|gurumangat|hali road|ghalib/i;

export function buildPlots(strokes: Stroke[], raster: Raster, commercialZones: number[][]): { plots: number[]; stats: Record<string, number> } {
  const plots: number[] = [];
  let res = 0, com = 0, vacant = 0;
  // longer strokes first so main frontages get the good plots
  const order = strokes.slice().sort((a, b) => rank(b) - rank(a) || b.pts.length - a.pts.length);
  for (const st of order) {
    if (st.cls === 'service' || st.cls === 'link' || st.closed) continue;
    const cum = cumulative(st.pts);
    const L = cum[cum.length - 1];
    if (L < 20) continue;
    for (const side of [1, -1]) {
      if (st.dual && st.medianSide === side) continue;
      const rng = new RNG(hash32('plots', st.id, side));
      let pCom: number;
      if (st.cls === 'trunk' || st.cls === 'primary' || st.cls === 'secondary') pCom = 0.8;
      else if (st.cls === 'tertiary') pCom = COMMERCIAL_NAMES.test(st.name ?? '') ? 0.92 : 0.3;
      else pCom = 0.03;
      if (COMMERCIAL_NAMES.test(st.name ?? '')) pCom = Math.max(pCom, 0.9);
      const verge = st.sidewalk > 0 ? st.sidewalk : 2.4;
      const gap = st.width / 2 + verge + 0.3;
      let s = st.trimStart + 3;
      const end = L - st.trimEnd - 3;
      let blockEnd = -1;
      let blockCom = false;
      while (s < end) {
        if (s > blockEnd) {
          blockEnd = s + rng.range(50, 140);
          blockCom = rng.chance(pCom);
        }
        const p0s = sampleAt(st.pts, cum, s);
        let isCom = blockCom;
        if (!isCom && commercialZones.some((z) => pointInPolygon(p0s.x, p0s.z, z))) isCom = true;
        const F = isCom ? rng.range(10, 20) : rng.range(14, 24);
        if (s + F > end) break;
        const p1s = sampleAt(st.pts, cum, s + F);
        if (p0s.tx * p1s.tx + p0s.tz * p1s.tz < 0.94) {
          s += 3;
          continue;
        }
        let tx = p1s.x - p0s.x, tz = p1s.z - p0s.z;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        const [lx, lz] = leftNormal(tx, tz);
        const nx = lx * side, nz = lz * side; // into the plot
        // raster rect: v axis is (-uz, ux) = right normal of u. For left-side plots flip u so v points into the plot.
        let ux = tx, uz = tz, ox = p0s.x + nx * gap, oz = p0s.z + nz * gap;
        if (side === 1) {
          ux = -tx;
          uz = -tz;
          ox = p0s.x + tx * F + nx * gap;
          oz = p0s.z + tz * F + nz * gap;
        }
        const Dmax = isCom ? rng.range(18, 30) : rng.range(26, 38);
        let D = 0;
        for (const f of [1, 0.8, 0.62, 0.5]) {
          const d = Dmax * f;
          if (d < (isCom ? 12 : 14)) break;
          if (raster.rectOccupancy(ox, oz, ux, uz, F, d, 1) <= 0.015) {
            D = d;
            break;
          }
        }
        if (!D) {
          s += 2.5;
          continue;
        }
        raster.fillRect(ox, oz, ux, uz, F, D, PLOT);
        if (!isCom && rng.chance(0.035)) {
          vacant++; // empty plot (dirt lot) – reserved but no house
          s += F;
          continue;
        }
        const fx = (p0s.x + p1s.x) / 2 + nx * gap;
        const fz = (p0s.z + p1s.z) / 2 + nz * gap;
        const angle = Math.atan2(nx, nz); // yaw: local +Z → into plot
        let floors: number;
        if (isCom) {
          floors = st.cls === 'primary' || st.cls === 'secondary' || st.cls === 'trunk' ? rng.weighted([2, 3, 4, 5, 6, 8], [0.12, 0.25, 0.25, 0.18, 0.12, 0.08]) : rng.weighted([2, 3, 4, 5], [0.3, 0.35, 0.25, 0.1]);
          com++;
        } else {
          floors = rng.weighted([1, 2, 3], [0.2, 0.62, 0.18]);
          res++;
        }
        plots.push(round1(fx), round1(fz), Math.round(angle * 1000) / 1000, round1(F), round1(D), isCom ? 1 : 0, floors, hash32('plot', fx, fz) % 100000);
        s += F + (isCom ? 0 : rng.range(0, 0.4));
      }
    }
  }
  return { plots, stats: { residentialPlots: res, commercialPlots: com, vacantPlots: vacant, plotCount: plots.length / PLOT_STRIDE } };
}

function rank(s: Stroke): number {
  return { trunk: 6, primary: 5, secondary: 4, tertiary: 3, link: 2, residential: 1, service: 0 }[s.cls];
}
