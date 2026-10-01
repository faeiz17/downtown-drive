// Colour grade as a 3D lookup table (postprocessing LUT3DEffect), generated in code instead of shipped as a .cube
// file so the look can be tuned in one place. The LUT maps display-referred sRGB to sRGB.
//
// Look: warm, slightly hazy Lahore afternoon. Lifted, slightly warm blacks (dust in the air); warm highlights against
// cooler shadows; a gentle S-curve for contrast; foliage pulled from neon green toward olive; overall saturation a
// touch down, with skin/brick/earth tones left alone.
import * as THREE from 'three';
import { LookupTexture } from 'postprocessing';

export interface GradeParams {
  lift: number; // black level (haze)
  contrast: number; // S-curve strength
  warmth: number; // highlight warmth
  coolShadows: number;
  saturation: number;
  greenToOlive: number; // 0..1
}

export const LAHORE_GRADE: GradeParams = { lift: 0.022, contrast: 0.22, warmth: 0.05, coolShadows: 0.018, saturation: 0.96, greenToOlive: 0.55 };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1) + 1e-6);
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  if (h < 0) h += 1;
  return [h, Math.min(1, s), l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = h * 6, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

export function gradeColor(r: number, g: number, b: number, p: GradeParams): [number, number, number] {
  // foliage: greens (hue ≈ 80°–160°) shift toward yellow-olive and lose some saturation
  let [h, s, l] = rgbToHsl(r, g, b);
  const greenness = smooth(0.2, 0.28, h) * (1 - smooth(0.4, 0.48, h)) * smooth(0.08, 0.3, s);
  h -= greenness * p.greenToOlive * 0.045;
  s *= 1 - greenness * p.greenToOlive * 0.3;
  s *= p.saturation;
  [r, g, b] = hslToRgb(h, clamp01(s), l);
  // S-curve around mid grey
  const curve = (x: number) => x + p.contrast * (x * x * (3 - 2 * x) - x);
  r = curve(r);
  g = curve(g);
  b = curve(b);
  // split tone by luminance
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const hi = smooth(0.35, 1, lum), lo = 1 - smooth(0, 0.45, lum);
  r += p.warmth * hi - p.coolShadows * 0.6 * lo;
  g += p.warmth * 0.35 * hi;
  b += -p.warmth * 0.9 * hi + p.coolShadows * lo;
  // lifted, warm blacks (haze)
  r = r * (1 - p.lift) + p.lift * 1.0;
  g = g * (1 - p.lift) + p.lift * 0.94;
  b = b * (1 - p.lift) + p.lift * 0.84;
  return [clamp01(r), clamp01(g), clamp01(b)];
}

export function createGradeLUT(p: GradeParams = LAHORE_GRADE, size = 32): LookupTexture {
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let bz = 0; bz < size; bz++) for (let gy = 0; gy < size; gy++) for (let rx = 0; rx < size; rx++) {
    const [r, g, b] = gradeColor(rx / (size - 1), gy / (size - 1), bz / (size - 1), p);
    data[i++] = Math.round(r * 255);
    data[i++] = Math.round(g * 255);
    data[i++] = Math.round(b * 255);
    data[i++] = 255;
  }
  const lut = new LookupTexture(data, size);
  lut.type = THREE.UnsignedByteType; // 8-bit: linear filtering works everywhere (float LUTs need an extension)
  // colorSpace stays linear (= "no conversion"): the effect feeds sRGB-encoded values in and expects them back as-is
  lut.needsUpdate = true;
  return lut;
}
