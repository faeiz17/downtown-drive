// Water drops on the lens as a REFRACTION map: every drop is a tiny sphere whose surface normal bends the picture behind
// it (inverted and magnified, like a real droplet), so streetlights turn into bokeh balls inside the drops.
// This file simulates the drops (spawn, grow, merge, run down, wiped away) and writes them into a small RGBA texture:
//   R,G = refraction direction, B = coverage, A = rim highlight. RainLensEffect (post pass) reads it.
import * as THREE from 'three';
import { Effect } from 'postprocessing';

const W = 640, H = 360;
/** windshield outline as seen from the driver's seat (fractions of the screen, y down) */
const SHIELD: [number, number][] = [[0.085, 0.605], [0.15, 0.27], [0.655, 0.24], [0.625, 0.605]];
function inShield(x: number, y: number): boolean {
  let inside = false;
  const px = x / W, py = y / H;
  for (let i = 0, j = SHIELD.length - 1; i < SHIELD.length; j = i++) {
    const [xi, yi] = SHIELD[i], [xj, yj] = SHIELD[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface Drop {
  x: number; y: number; r: number; vy: number; age: number; run: number;
}

export class RainLens {
  readonly data = new Uint8Array(W * H * 4);
  readonly texture = new THREE.DataTexture(this.data, W, H, THREE.RGBAFormat);
  private drops: Drop[] = [];
  private micro: { x: number; y: number; r: number; k: number }[] = [];
  private acc = 0;
  /** wiper state (cockpit views): current / previous angle in radians, or -1 when idle */
  wiper = { ang: -1, prev: -1, t: 0 };
  amount = 0;
  private glassOnly = false;

  constructor() {
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    for (let i = 0; i < 420; i++) this.micro.push({ x: Math.random() * W, y: Math.random() * H, r: 0.9 + Math.random() * 1.4, k: Math.random() });
  }

  /** cockpit = wipers; glassOnly = confine the water to the windshield (driver's view) */
  update(dt: number, rain: number, kmh: number, cockpit: boolean, glassOnly = false): void {
    this.amount = rain;
    this.glassOnly = glassOnly;
    const wind = Math.min(1, kmh / 160);
    // spawn: lots of small, a few big
    this.acc += dt * (cockpit ? 70 : 16) * rain;
    while (this.acc > 1 && this.drops.length < 120) {
      this.acc--;
      const big = Math.random() < 0.12;
      let sx = Math.random() * W, sy = Math.random() * H;
      for (let t = 0; this.glassOnly && t < 8 && !inShield(sx, sy); t++) {
        sx = Math.random() * W;
        sy = Math.random() * H;
      }
      this.drops.push({ x: sx, y: sy, r: big ? 9 + Math.random() * 6 : 3 + Math.random() * 4, vy: 0, age: 0, run: 0 });
    }
    if (this.acc > 1) this.acc = 0;
    // wipers
    let wa = -1, wp = -1;
    const px = W * 0.62, py = H * 1.04, len = H * 1.0;
    if (cockpit && rain > 0.15) {
      this.wiper.t += dt;
      const period = 1.5 - 0.5 * rain, t = (this.wiper.t % period) / period;
      const sweep = t < 0.5 ? t * 2 : 2 - t * 2;
      wa = Math.PI * 0.94 - sweep * Math.PI * 0.88;
      wp = this.wiper.ang >= 0 ? this.wiper.ang : wa;
    }
    this.wiper.prev = wp;
    this.wiper.ang = wa;
    // motion + merging
    const ds = this.drops;
    for (let i = ds.length - 1; i >= 0; i--) {
      const d = ds[i];
      d.age += dt;
      // surface tension: only drops above a size start sliding; they accelerate as they gather neighbours
      if (d.r > 9.5 || d.run > 0) {
        d.vy += dt * (30 + 140 * rain) * Math.min(1.8, (d.r - 6) / 4);
        d.vy *= 1 - dt * 1.2;
        d.run += dt;
      }
      d.y += d.vy * dt - wind * dt * 26 * (d.r > 4 ? 1 : 0.35);
      d.x += wind * dt * 10 * (Math.random() - 0.4);
      d.r += dt * 0.05 * rain;
      if (d.y > H + 12 || d.y < -12 || d.x < -12 || d.x > W + 12 || (this.glassOnly && !inShield(d.x, d.y))) {
        ds.splice(i, 1);
        continue;
      }
      if (wa >= 0) {
        const a = Math.atan2(py - d.y, d.x - px), dist = Math.hypot(d.x - px, d.y - py);
        if (dist < len && a > Math.min(wa, wp) - 0.05 && a < Math.max(wa, wp) + 0.05) ds.splice(i, 1);
      }
    }
    // coalesce touching drops (the bigger one swallows the smaller, areas add)
    for (let i = 0; i < ds.length; i++)
      for (let j = ds.length - 1; j > i; j--) {
        const a = ds[i], b = ds[j];
        const dx = a.x - b.x, dy = a.y - b.y, rr = a.r + b.r;
        if (dx * dx + dy * dy < rr * rr * 0.5) {
          const big = a.r >= b.r ? a : b;
          big.x = (a.x * a.r * a.r + b.x * b.r * b.r) / (a.r * a.r + b.r * b.r);
          big.y = (a.y * a.r * a.r + b.y * b.r * b.r) / (a.r * a.r + b.r * b.r);
          big.r = Math.min(18, Math.sqrt(a.r * a.r + b.r * b.r));
          big.vy = Math.max(a.vy, b.vy);
          ds[i] = big;
          ds.splice(j, 1);
        }
      }
    this.render();
  }

  private stamp(cx: number, cy: number, r: number, strength: number, tail: boolean): void {
    const d = this.data;
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(W - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r * (tail ? 1 : 1) - 1)), y1 = Math.min(H - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / (r * (tail ? 1.0 : 1.12));
        const q = dx * dx + dy * dy;
        if (q >= 1) continue;
        const z = Math.sqrt(1 - q);
        // sphere cap normal; the refracted picture is flipped, so the map points outwards and the shader subtracts it
        const nx = dx, ny = -dy; // screen y runs down, texture v runs up
        const i = ((H - 1 - y) * W + x) * 4;
        const edge = Math.min(1, (1 - Math.sqrt(q)) * 5);
        d[i] = 128 + 127 * nx * (1 - 0.35 * z);
        d[i + 1] = 128 + 127 * ny * (1 - 0.35 * z);
        d[i + 2] = 255 * edge * strength;
        // rim light: bright on the lower edge (sky light through the drop), darker on top
        const rim = Math.pow(1 - z, 1.6) * (0.55 + 0.45 * -ny) + (z > 0.82 ? 0.25 * Math.pow((z - 0.82) / 0.18, 3) * (0.5 + 0.5 * ny) : 0);
        d[i + 3] = Math.min(255, 255 * rim * strength);
      }
  }

  private render(): void {
    this.data.fill(0);
    // wet mist: many tiny static droplets, more of them the harder it rains
    const m = this.micro;
    const n = Math.floor(m.length * Math.min(1, this.amount * 1.1));
    for (let i = 0; i < n; i++) if (!this.glassOnly || inShield(m[i].x, m[i].y)) this.stamp(m[i].x, m[i].y, m[i].r, 0.8, false);
    for (const d of this.drops) {
      // a running drop leaves a thin wet trail above it
      if (d.run > 0.2) for (let k = 1; k < 6; k++) this.stamp(d.x, d.y - k * d.r * 0.9, Math.max(0.9, d.r * (0.32 - k * 0.04)), 0.45, false);
      this.stamp(d.x, d.y, d.r, 1, false);
    }
    this.texture.needsUpdate = true;
  }
}

/** Post effect: bends the picture inside every drop and adds the rim light. Place it first in a pass (it edits the UVs). */
export class RainLensEffect extends Effect {
  constructor(lens: RainLens) {
    super('RainLensEffect', /* glsl */ `
      uniform sampler2D tLens;
      uniform float uAmount;
      float rainRim = 0.0;
      float rainCover = 0.0;
      void mainUv(inout vec2 uv) {
        vec4 L = texture2D(tLens, uv);
        rainCover = L.b * uAmount;
        rainRim = L.a * uAmount;
        vec2 n = L.rg * 2.0 - 1.0;
        // inverted + magnified: sample from the opposite side of the drop centre
        uv -= n * (0.075 * L.b) * uAmount;
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float l = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 c = inputColor.rgb * (1.0 - 0.22 * rainCover);              // drops are a touch darker...
        c += vec3(0.78, 0.88, 1.0) * rainRim * (0.10 + 0.55 * min(l, 1.2)) * 0.5; // ...with a sky-lit rim
        outputColor = vec4(c, inputColor.a);
      }`, { uniforms: new Map<string, THREE.Uniform>([['tLens', new THREE.Uniform(lens.texture)], ['uAmount', new THREE.Uniform(0)]]) });
    this.lens = lens;
  }
  private lens: RainLens;
  override update(): void {
    this.uniforms.get('uAmount')!.value = Math.min(1, this.lens.amount * 1.5);
  }
}
