// Procedural texture atlas for all static world surfaces (facades, walls, gates, pavers, grass, roofs…).
// Three textures share one layout: colour (sRGB), emissive (night lights) and ORM (G = roughness, B = metalness).
// Geometry stores per-vertex tile UVs (repeating) plus the atlas cell rect; AtlasMaterial wraps inside the cell.
import * as THREE from 'three';
import { RNG } from '../core/rng';

export interface Cell {
  u0: number;
  v0: number;
  du: number;
  dv: number;
  /** real-world size (metres) of one texture repeat: used to compute tile UVs */
  sx: number;
  sy: number;
}

type Painter = (c: CanvasRenderingContext2D, e: CanvasRenderingContext2D, w: number, h: number, rng: RNG) => void;
interface CellDef {
  name: string;
  w: number;
  h: number;
  sx: number;
  sy: number;
  rough: number;
  metal: number;
  paint: Painter;
}

const SIZE = 4096;
const PAD = 8;

export class WorldAtlas {
  readonly cells: Record<string, Cell> = {};
  readonly names: string[] = [];
  map!: THREE.CanvasTexture;
  emissive!: THREE.CanvasTexture;
  orm!: THREE.CanvasTexture;
  readonly facadeResidential: string[] = [];
  readonly facadeCommercial: string[] = [];
  readonly shopfronts: string[] = [];
  readonly gates: string[] = [];
  readonly wallStyles: string[] = [];

  build(): void {
    const defs = cellDefs(this);
    const color = makeCanvas(SIZE, SIZE);
    const emis = makeCanvas(SIZE, SIZE);
    const orm = makeCanvas(SIZE, SIZE);
    const cctx = color.getContext('2d')!;
    const ectx = emis.getContext('2d')!;
    const octx = orm.getContext('2d')!;
    ectx.fillStyle = '#000';
    ectx.fillRect(0, 0, SIZE, SIZE);
    octx.fillStyle = 'rgb(0,230,0)';
    octx.fillRect(0, 0, SIZE, SIZE);

    // shelf packing (defs are ordered tall → short for decent packing)
    let x = 0, y = 0, rowH = 0;
    const rng = new RNG(424242);
    for (const d of defs) {
      const W = d.w + PAD * 2, H = d.h + PAD * 2;
      if (x + W > SIZE) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      if (y + H > SIZE) throw new Error('atlas overflow at ' + d.name);
      // paint into temp canvases, then blit with wrap padding
      const tc = makeCanvas(d.w, d.h), te = makeCanvas(d.w, d.h);
      const tcx = tc.getContext('2d')!, tex = te.getContext('2d')!;
      tex.fillStyle = '#000';
      tex.fillRect(0, 0, d.w, d.h);
      d.paint(tcx, tex, d.w, d.h, rng);
      blitWrapped(cctx, tc, x, y, d.w, d.h);
      blitWrapped(ectx, te, x, y, d.w, d.h);
      octx.fillStyle = `rgb(0,${Math.round(d.rough * 255)},${Math.round(d.metal * 255)})`;
      octx.fillRect(x, y, W, H);
      this.cells[d.name] = {
        u0: (x + PAD) / SIZE,
        v0: 1 - (y + PAD + d.h) / SIZE,
        du: d.w / SIZE,
        dv: d.h / SIZE,
        sx: d.sx,
        sy: d.sy,
      };
      this.names.push(d.name);
      x += W;
      rowH = Math.max(rowH, H);
    }
    // glass cells: override ORM per-pixel (window panes shiny, frames rough) handled by painter via special names
    this.map = toTexture(color, true);
    this.emissive = toTexture(emis, true);
    this.orm = toTexture(orm, false);
  }

  cell(name: string): Cell {
    const c = this.cells[name];
    if (!c) throw new Error('unknown atlas cell ' + name);
    return c;
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function blitWrapped(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const sx0 = dx < 0 ? w - PAD : 0, sw = dx === 0 ? w : PAD;
      const sy0 = dy < 0 ? h - PAD : 0, sh = dy === 0 ? h : PAD;
      const tx = x + PAD + (dx < 0 ? -PAD : dx > 0 ? w : 0);
      const ty = y + PAD + (dy < 0 ? -PAD : dy > 0 ? h : 0);
      ctx.drawImage(src, sx0, sy0, sw, sh, tx, ty, sw, sh);
    }
}

function toTexture(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------------------------------------
// painting helpers

export function noise(c: CanvasRenderingContext2D, w: number, h: number, rng: RNG, amount: number, count: number, size = 1.5) {
  for (let i = 0; i < count; i++) {
    const v = rng.next() < 0.5 ? 0 : 255;
    c.fillStyle = `rgba(${v},${v},${v},${amount * rng.next()})`;
    const s = size * (0.5 + rng.next());
    c.fillRect(rng.next() * w, rng.next() * h, s, s);
  }
}

function stains(c: CanvasRenderingContext2D, w: number, h: number, rng: RNG, n: number, color: string, alpha: number) {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * w, y = rng.next() * h, r = 10 + rng.next() * w * 0.15;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', String(alpha * rng.next())));
    g.addColorStop(1, color.replace('A', '0'));
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** vertical rain streaks typical of Lahore plaster */
function streaks(c: CanvasRenderingContext2D, w: number, h: number, rng: RNG, n: number, alpha = 0.08) {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h * 0.6;
    const len = h * (0.2 + rng.next() * 0.6);
    const g = c.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, `rgba(40,35,30,${alpha * rng.next()})`);
    g.addColorStop(1, 'rgba(40,35,30,0)');
    c.fillStyle = g;
    c.fillRect(x, y, 2 + rng.next() * 6, len);
  }
}

interface WindowOpts {
  frame: string;
  glass: string;
  grill?: string;
  lit: number; // probability of being lit at night
  ac?: number; // probability of AC unit under window
  arch?: boolean;
  shade?: string; // sunshade/chajja colour above window
}

function drawWindow(c: CanvasRenderingContext2D, e: CanvasRenderingContext2D, x: number, y: number, ww: number, wh: number, o: WindowOpts, rng: RNG) {
  // chajja (sunshade) above
  if (o.shade) {
    c.fillStyle = o.shade;
    c.fillRect(x - ww * 0.12, y - wh * 0.14, ww * 1.24, wh * 0.1);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(x - ww * 0.12, y - wh * 0.04, ww * 1.24, wh * 0.05);
  }
  c.fillStyle = o.frame;
  if (o.arch) {
    c.beginPath();
    c.moveTo(x - 3, y + wh + 3);
    c.lineTo(x - 3, y + ww / 2);
    c.arc(x + ww / 2, y + ww / 2, ww / 2 + 3, Math.PI, 0);
    c.lineTo(x + ww + 3, y + wh + 3);
    c.closePath();
    c.fill();
  } else c.fillRect(x - 3, y - 3, ww + 6, wh + 6);
  // glass with sky reflection gradient
  const g = c.createLinearGradient(x, y, x + ww, y + wh);
  g.addColorStop(0, o.glass);
  g.addColorStop(0.5, shade(o.glass, 0.7));
  g.addColorStop(1, shade(o.glass, 1.15));
  c.fillStyle = g;
  if (o.arch) {
    c.beginPath();
    c.moveTo(x, y + wh);
    c.lineTo(x, y + ww / 2);
    c.arc(x + ww / 2, y + ww / 2, ww / 2, Math.PI, 0);
    c.lineTo(x + ww, y + wh);
    c.closePath();
    c.fill();
  } else c.fillRect(x, y, ww, wh);
  // curtains
  if (rng.chance(0.5)) {
    c.fillStyle = rng.pick(['rgba(200,180,140,0.55)', 'rgba(150,60,50,0.4)', 'rgba(230,230,220,0.5)', 'rgba(60,80,120,0.4)']);
    c.fillRect(x, y, ww * rng.range(0.2, 0.5), wh);
  }
  // mullions
  c.fillStyle = o.frame;
  c.fillRect(x + ww / 2 - 1.5, y, 3, wh);
  if (wh > ww * 1.2) c.fillRect(x, y + wh * 0.35, ww, 2);
  // security grill (very common)
  if (o.grill) {
    c.strokeStyle = o.grill;
    c.lineWidth = 1.5;
    for (let gx = x + 6; gx < x + ww; gx += 7) {
      c.beginPath();
      c.moveTo(gx, y);
      c.lineTo(gx, y + wh);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(x, y + wh * 0.5);
    c.lineTo(x + ww, y + wh * 0.5);
    c.stroke();
  }
  // lit at night
  if (rng.chance(o.lit)) {
    const warm = rng.pick(['#ffcf7a', '#ffe2a8', '#fff3d6', '#dfe9ff', '#ffd68a']);
    e.fillStyle = warm;
    e.globalAlpha = rng.range(0.45, 1);
    if (o.arch) {
      e.beginPath();
      e.moveTo(x, y + wh);
      e.lineTo(x, y + ww / 2);
      e.arc(x + ww / 2, y + ww / 2, ww / 2, Math.PI, 0);
      e.lineTo(x + ww, y + wh);
      e.closePath();
      e.fill();
    } else e.fillRect(x, y, ww, wh);
    e.globalAlpha = 1;
    if (o.grill) {
      e.strokeStyle = '#000';
      e.lineWidth = 1.5;
      for (let gx = x + 6; gx < x + ww; gx += 7) {
        e.beginPath();
        e.moveTo(gx, y);
        e.lineTo(gx, y + wh);
        e.stroke();
      }
    }
  }
  // split AC outdoor unit
  if (o.ac && rng.chance(o.ac)) {
    const aw = ww * 0.75, ah = wh * 0.32;
    const ax = x + (ww - aw) / 2, ay = y + wh + 8;
    c.fillStyle = '#e9e9e4';
    c.fillRect(ax, ay, aw, ah);
    c.fillStyle = '#b9b9b4';
    c.beginPath();
    c.arc(ax + aw * 0.35, ay + ah / 2, ah * 0.36, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#999';
    c.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      c.beginPath();
      c.moveTo(ax + aw * 0.65, ay + 4 + k * (ah - 8) / 3);
      c.lineTo(ax + aw - 4, ay + 4 + k * (ah - 8) / 3);
      c.stroke();
    }
  }
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function plaster(c: CanvasRenderingContext2D, w: number, h: number, base: string, rng: RNG, dirt = 1) {
  c.fillStyle = base;
  c.fillRect(0, 0, w, h);
  noise(c, w, h, rng, 0.06, (w * h) / 40, 1.4);
  stains(c, w, h, rng, 6 * dirt, 'rgba(90,80,60,A)', 0.12);
  streaks(c, w, h, rng, 10 * dirt, 0.07);
}

// ------------------------------------------------------------------------------------------------
// cell definitions

function cellDefs(atlas: WorldAtlas): CellDef[] {
  const defs: CellDef[] = [];
  const add = (name: string, w: number, h: number, sx: number, sy: number, rough: number, metal: number, paint: Painter) =>
    defs.push({ name, w, h, sx, sy, rough, metal, paint });

  // --- residential facades: 1 floor × 4 bays (12 m × 3.2 m) --------------------------------------------------
  const resStyles: { name: string; base: string; frame: string; glass: string; grill?: string; arch?: boolean; band?: string; stone?: string }[] = [
    { name: 'res_cream', base: '#e8dcc0', frame: '#6b4a30', glass: '#56677a', grill: '#2b2b2b', band: '#d4c4a0' },
    { name: 'res_white', base: '#efeeea', frame: '#3a3a3a', glass: '#4f6a86', band: '#9aa0a6', stone: '#8f8f8a' },
    { name: 'res_beige_arch', base: '#e3cfa8', frame: '#7a5638', glass: '#5c6f80', grill: '#1d1d1d', arch: true, band: '#c9b186' },
    { name: 'res_grey_modern', base: '#b9bcbe', frame: '#1f1f1f', glass: '#2f3e4c', band: '#5c5f62', stone: '#6a6d70' },
    { name: 'res_peach', base: '#e9c8a8', frame: '#ffffff', glass: '#5d7085', grill: '#3a2a20', band: '#d9ae88' },
    { name: 'res_brick', base: '#9c5a3e', frame: '#e8e0d0', glass: '#4d5f70', grill: '#222', band: '#e3d8c4' },
  ];
  for (const s of resStyles) {
    atlas.facadeResidential.push(s.name);
    add(s.name, 1024, 272, 12, 3.2, 0.9, 0, (c, e, w, h, rng) => {
      if (s.name === 'res_brick') brick(c, w, h, rng, s.base);
      else plaster(c, w, h, s.base, rng);
      // stone cladding panel on modern styles
      if (s.stone && rng.chance(1)) {
        const px = w * 0.52, pw = w * 0.22;
        c.fillStyle = s.stone;
        c.fillRect(px, 0, pw, h);
        c.strokeStyle = 'rgba(0,0,0,0.25)';
        for (let yy = 0; yy < h; yy += 22) {
          c.beginPath();
          c.moveTo(px, yy);
          c.lineTo(px + pw, yy);
          c.stroke();
        }
        noise(c, w, h, rng, 0.05, 800);
      }
      // floor band (slab edge)
      c.fillStyle = s.band ?? shade(s.base, 0.85);
      c.fillRect(0, h - 16, w, 16);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(0, h - 3, w, 3);
      const bays = 4;
      for (let b = 0; b < bays; b++) {
        const bx = (b + 0.5) * (w / bays);
        if (s.stone && bx > w * 0.52 && bx < w * 0.74) continue;
        if (rng.chance(0.12)) continue; // blank wall
        const ww = rng.range(0.4, 0.6) * (w / bays), wh = h * rng.range(0.42, 0.52);
        drawWindow(c, e, bx - ww / 2, h * 0.24, ww, wh, { frame: s.frame, glass: s.glass, grill: s.grill, lit: 0.45, ac: 0.35, arch: s.arch, shade: rng.chance(0.6) ? shade(s.band ?? s.base, 0.95) : undefined }, rng);
      }
    });
  }

  // --- commercial upper facades (12 m × 3.4 m) --------------------------------------------------------------
  const comStyles: { name: string; kind: 'glass' | 'strip' | 'panel' | 'brick' | 'plaster'; base: string; glass: string; metal: number; rough: number }[] = [
    { name: 'com_glass_blue', kind: 'glass', base: '#2c4a5e', glass: '#3f6f8e', metal: 0.6, rough: 0.18 },
    { name: 'com_glass_green', kind: 'glass', base: '#28493f', glass: '#3d7466', metal: 0.6, rough: 0.2 },
    { name: 'com_strip_white', kind: 'strip', base: '#e6e4de', glass: '#33495c', metal: 0.1, rough: 0.7 },
    { name: 'com_panel_grey', kind: 'panel', base: '#9ea3a7', glass: '#2e4254', metal: 0.35, rough: 0.45 },
    { name: 'com_brick', kind: 'brick', base: '#a0603f', glass: '#34475a', metal: 0, rough: 0.9 },
    { name: 'com_plaster_cream', kind: 'plaster', base: '#e0d2b2', glass: '#3c5264', metal: 0, rough: 0.85 },
  ];
  for (const s of comStyles) {
    atlas.facadeCommercial.push(s.name);
    add(s.name, 1024, 290, 12, 3.4, s.rough, s.metal, (c, e, w, h, rng) => {
      if (s.kind === 'glass') {
        c.fillStyle = s.base;
        c.fillRect(0, 0, w, h);
        const cols = 8;
        for (let i = 0; i < cols; i++) {
          const g = c.createLinearGradient(0, 0, w, h);
          g.addColorStop(0, shade(s.glass, 1.25));
          g.addColorStop(0.6, s.glass);
          g.addColorStop(1, shade(s.glass, 0.75));
          c.fillStyle = g;
          c.fillRect(i * (w / cols) + 3, 6, w / cols - 6, h - 22);
          if (rng.chance(0.5)) {
            e.fillStyle = rng.pick(['#fff5dc', '#e8f0ff', '#fff0c8']);
            e.globalAlpha = rng.range(0.35, 0.9);
            e.fillRect(i * (w / cols) + 3, 6, w / cols - 6, h - 22);
            e.globalAlpha = 1;
          }
        }
        c.fillStyle = shade(s.base, 0.6);
        c.fillRect(0, h - 16, w, 16);
      } else if (s.kind === 'strip') {
        plaster(c, w, h, s.base, rng, 0.6);
        c.fillStyle = s.glass;
        c.fillRect(0, h * 0.28, w, h * 0.42);
        for (let i = 0; i < 12; i++) {
          c.fillStyle = '#d8d8d8';
          c.fillRect(i * (w / 12), h * 0.28, 4, h * 0.42);
          if (rng.chance(0.55)) {
            e.fillStyle = rng.pick(['#fff3d0', '#eaf2ff']);
            e.globalAlpha = rng.range(0.4, 0.9);
            e.fillRect(i * (w / 12) + 4, h * 0.28, w / 12 - 4, h * 0.42);
            e.globalAlpha = 1;
          }
        }
        const g = c.createLinearGradient(0, h * 0.28, 0, h * 0.7);
        g.addColorStop(0, 'rgba(255,255,255,0.18)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, h * 0.28, w, h * 0.42);
      } else if (s.kind === 'panel') {
        c.fillStyle = s.base;
        c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(0,0,0,0.3)';
        for (let i = 0; i <= 8; i++) {
          c.beginPath();
          c.moveTo(i * (w / 8), 0);
          c.lineTo(i * (w / 8), h);
          c.stroke();
        }
        for (let i = 0; i < 4; i++) {
          const x = i * (w / 4) + w / 16;
          drawWindow(c, e, x, h * 0.2, w / 8, h * 0.55, { frame: '#333', glass: s.glass, lit: 0.55 }, rng);
        }
      } else if (s.kind === 'brick') {
        brick(c, w, h, rng, s.base);
        for (let i = 0; i < 6; i++) drawWindow(c, e, i * (w / 6) + w / 24, h * 0.22, w / 10, h * 0.5, { frame: '#e8e2d4', glass: s.glass, lit: 0.5, ac: 0.3, shade: '#d8cfbf' }, rng);
        c.fillStyle = '#d9cfbd';
        c.fillRect(0, h - 14, w, 14);
      } else {
        plaster(c, w, h, s.base, rng);
        for (let i = 0; i < 6; i++) drawWindow(c, e, i * (w / 6) + w / 30, h * 0.2, w / 8, h * 0.52, { frame: '#40372c', glass: s.glass, lit: 0.5, ac: 0.45, grill: rng.chance(0.4) ? '#222' : undefined }, rng);
        c.fillStyle = shade(s.base, 0.85);
        c.fillRect(0, h - 14, w, 14);
      }
    });
  }

  // --- ground-floor shopfronts (12 m × 4.4 m) ---------------------------------------------------------------
  for (let k = 0; k < 4; k++) {
    const name = 'shop_' + k;
    atlas.shopfronts.push(name);
    add(name, 1024, 376, 12, 4.4, 0.6, 0.15, (c, e, w, h, rng) => {
      c.fillStyle = ['#d8d4cc', '#c9c2b4', '#bfc3c6', '#e2dccf'][k];
      c.fillRect(0, 0, w, h);
      const units = 3;
      const uw = w / units;
      for (let u = 0; u < units; u++) {
        const x0 = u * uw + 10, x1 = (u + 1) * uw - 10;
        const top = h * 0.08, bot = h - 6;
        // pillar
        c.fillStyle = '#9a948a';
        c.fillRect(u * uw, 0, 10, h);
        const type = rng.int(0, 2);
        if (type === 0) {
          // rolling shutter (down)
          c.fillStyle = '#8f9396';
          c.fillRect(x0, top, x1 - x0, bot - top);
          c.fillStyle = 'rgba(0,0,0,0.18)';
          for (let y = top; y < bot; y += 6) c.fillRect(x0, y, x1 - x0, 2);
          c.fillStyle = '#6b6f72';
          c.fillRect(x0, bot - 10, x1 - x0, 10);
        } else {
          // open shop / glass front with goods & bright interior at night
          const g = c.createLinearGradient(0, top, 0, bot);
          g.addColorStop(0, '#f2eee4');
          g.addColorStop(1, '#b9b2a4');
          c.fillStyle = g;
          c.fillRect(x0, top, x1 - x0, bot - top);
          // shelves / goods
          for (let s = 0; s < 4; s++) {
            const y = top + 20 + s * ((bot - top - 30) / 4);
            c.fillStyle = '#6b5a45';
            c.fillRect(x0 + 6, y + 18, x1 - x0 - 12, 3);
            for (let gx = x0 + 10; gx < x1 - 14; gx += rng.range(8, 16)) {
              c.fillStyle = `hsl(${rng.int(0, 360)},${rng.int(30, 70)}%,${rng.int(35, 65)}%)`;
              c.fillRect(gx, y + 4, rng.range(5, 10), 14);
            }
          }
          if (type === 2) {
            c.fillStyle = 'rgba(120,160,190,0.35)';
            c.fillRect(x0, top, x1 - x0, bot - top);
            c.fillStyle = '#3a3a3a';
            c.fillRect((x0 + x1) / 2 - 2, top, 4, bot - top);
          }
          e.fillStyle = rng.pick(['#fff4dc', '#ffffff', '#fff0c0', '#eaf4ff']);
          e.globalAlpha = rng.range(0.7, 1);
          e.fillRect(x0, top, x1 - x0, bot - top);
          e.globalAlpha = 1;
          // half-raised shutter
          if (rng.chance(0.4)) {
            const sh = (bot - top) * rng.range(0.1, 0.35);
            c.fillStyle = '#8f9396';
            c.fillRect(x0, top, x1 - x0, sh);
            e.fillStyle = '#000';
            e.fillRect(x0, top, x1 - x0, sh);
          }
        }
      }
      c.fillStyle = '#5a5650';
      c.fillRect(0, 0, w, h * 0.08);
    });
  }

  // --- boundary walls (2.4 m tall repeat, 4 m wide) ---------------------------------------------------------
  const walls: [string, string, string][] = [
    ['wall_cream', '#e2d5b8', '#c9b996'],
    ['wall_white', '#eceae4', '#b7b4ab'],
    ['wall_grey', '#a9aba8', '#6f716f'],
    ['wall_brick', '#9a5a40', '#d9cfbd'],
    ['wall_stone', '#c8b48e', '#8e7a58'],
  ];
  for (const [name, base, cap] of walls) {
    atlas.wallStyles.push(name);
    add(name, 512, 312, 4, 2.4, 0.92, 0, (c, _e, w, h, rng) => {
      if (name === 'wall_brick') brick(c, w, h, rng, base);
      else plaster(c, w, h, base, rng, 1.4);
      if (name === 'wall_stone') {
        c.strokeStyle = 'rgba(60,45,30,0.35)';
        for (let y = 20; y < h; y += 26) for (let x = (y / 26) % 2 ? 0 : 30; x < w; x += 60) c.strokeRect(x, y, 60, 26);
      }
      c.fillStyle = cap;
      c.fillRect(0, 0, w, 18);
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.fillRect(0, 18, w, 4);
      // grime at the bottom
      const g = c.createLinearGradient(0, h * 0.75, 0, h);
      g.addColorStop(0, 'rgba(70,60,45,0)');
      g.addColorStop(1, 'rgba(70,60,45,0.35)');
      c.fillStyle = g;
      c.fillRect(0, h * 0.75, w, h * 0.25);
    });
  }

  // --- gates (4.2 m × 2.4 m) --------------------------------------------------------------------------------
  const gates: [string, (c: CanvasRenderingContext2D, w: number, h: number, rng: RNG) => void][] = [
    ['gate_black', (c, w, h) => {
      c.fillStyle = '#1b1c1e';
      c.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) {
        c.fillStyle = 'rgba(255,255,255,0.06)';
        c.fillRect(x, 0, 3, h);
      }
      c.fillStyle = '#e6e6e6';
      c.fillRect(0, h * 0.14, w, 10);
      for (let x = 18; x < w; x += 34) {
        c.beginPath();
        c.arc(x, h * 0.14 + 5, 5, 0, Math.PI * 2);
        c.fillStyle = '#1b1c1e';
        c.fill();
      }
      c.fillStyle = '#0e0e0e';
      c.fillRect(w / 2 - 2, 0, 4, h);
    }],
    ['gate_brown', (c, w, h) => {
      c.fillStyle = '#4a2c1c';
      c.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 10) {
        c.fillStyle = x % 20 ? 'rgba(0,0,0,0.2)' : 'rgba(255,220,180,0.06)';
        c.fillRect(x, h * 0.25, 5, h * 0.75);
      }
      c.fillStyle = '#6b4430';
      c.fillRect(0, 0, w, h * 0.22);
      c.fillStyle = '#2a1a10';
      c.fillRect(w / 2 - 2, 0, 4, h);
    }],
    ['gate_ornate', (c, w, h) => {
      c.fillStyle = '#e7d9a8';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#1a1a1a';
      c.lineWidth = 6;
      c.strokeRect(6, 6, w - 12, h - 12);
      c.lineWidth = 4;
      for (let x = 30; x < w - 20; x += 48) {
        c.strokeRect(x, 30, 30, h - 60);
        c.beginPath();
        c.arc(x + 15, h / 2, 10, 0, Math.PI * 2);
        c.stroke();
      }
      c.strokeStyle = '#7a4a28';
      c.lineWidth = 3;
      for (let x = 50; x < w; x += 96) {
        c.beginPath();
        c.ellipse(x, h / 2, 22, 34, 0, 0, Math.PI * 2);
        c.stroke();
      }
    }],
    ['gate_grey', (c, w, h) => {
      c.fillStyle = '#6e7174';
      c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 14) {
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(0, y, w, 3);
      }
      c.fillStyle = '#e8e8e8';
      c.fillRect(0, h * 0.1, w, 22);
      c.fillStyle = '#2a2c2e';
      c.fillRect(w / 2 - 2, 0, 4, h);
    }],
  ];
  for (const [name, fn] of gates) {
    atlas.gates.push(name);
    add(name, 512, 292, 4.2, 2.4, 0.5, 0.6, (c, _e, w, h, rng) => fn(c, w, h, rng));
  }

  // --- ground surfaces ----------------------------------------------------------------------------------------
  add('pavers', 256, 256, 2, 2, 0.85, 0, (c, _e, w, h, rng) => {
    c.fillStyle = '#9d9a94';
    c.fillRect(0, 0, w, h);
    const tile = 32;
    for (let y = 0; y < h; y += tile)
      for (let x = 0; x < w; x += tile) {
        const red = ((x / tile + y / tile) % 4) === 0;
        c.fillStyle = red ? '#8e5b4c' : `rgb(${150 + rng.int(-10, 10)},${146 + rng.int(-10, 10)},${140 + rng.int(-10, 10)})`;
        c.fillRect(x + 1, y + 1, tile - 2, tile - 2);
      }
    noise(c, w, h, rng, 0.1, 2500);
  });
  add('pavers_red', 256, 256, 2, 2, 0.85, 0, (c, _e, w, h, rng) => {
    c.fillStyle = '#6e4a3e';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16)
      for (let x = (y / 16) % 2 ? 0 : 16; x < w + 32; x += 32) {
        c.fillStyle = `rgb(${130 + rng.int(-14, 14)},${80 + rng.int(-10, 10)},${66 + rng.int(-8, 8)})`;
        c.fillRect(x - 32 + 1, y + 1, 30, 14);
      }
    noise(c, w, h, rng, 0.1, 2000);
  });
  add('concrete', 256, 256, 3, 3, 0.9, 0, (c, _e, w, h, rng) => {
    c.fillStyle = '#b1ada4';
    c.fillRect(0, 0, w, h);
    noise(c, w, h, rng, 0.12, 5000, 1.2);
    stains(c, w, h, rng, 5, 'rgba(70,65,55,A)', 0.2);
  });
  add('roof', 256, 256, 6, 6, 0.95, 0, (c, _e, w, h, rng) => {
    c.fillStyle = '#a49c90';
    c.fillRect(0, 0, w, h);
    noise(c, w, h, rng, 0.12, 5000, 1.5);
    stains(c, w, h, rng, 10, 'rgba(50,45,40,A)', 0.3);
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < w; x += 64) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
  });
  add('tile_terracotta', 256, 256, 2, 2, 0.8, 0, (c, _e, w, h, rng) => roofTiles(c, w, h, rng, '#a4492e'));
  add('tile_green', 256, 256, 2, 2, 0.6, 0, (c, _e, w, h, rng) => roofTiles(c, w, h, rng, '#3e6b4f'));
  add('grass', 512, 512, 6, 6, 0.95, 0, (c, _e, w, h, rng) => grass(c, w, h, rng, [88, 128, 52]));
  add('grass_lawn', 512, 512, 5, 5, 0.95, 0, (c, _e, w, h, rng) => grass(c, w, h, rng, [74, 132, 48]));
  add('grass_dry', 512, 512, 8, 8, 0.95, 0, (c, _e, w, h, rng) => grass(c, w, h, rng, [128, 126, 72], true));
  add('dirt', 256, 256, 5, 5, 0.97, 0, (c, _e, w, h, rng) => {
    c.fillStyle = '#9b8a6c';
    c.fillRect(0, 0, w, h);
    noise(c, w, h, rng, 0.2, 6000, 2);
    stains(c, w, h, rng, 8, 'rgba(80,70,50,A)', 0.3);
  });
  add('curb', 256, 64, 2, 0.5, 0.8, 0, (c, _e, w, h, rng) => {
    // black & yellow painted curb (main roads)
    for (let x = 0; x < w; x += 64) {
      c.fillStyle = (x / 64) % 2 ? '#1e1e1e' : '#d9b21e';
      c.fillRect(x, 0, 64, h);
    }
    noise(c, w, h, rng, 0.18, 800);
    stains(c, w, h, rng, 3, 'rgba(60,50,40,A)', 0.4);
  });
  add('curb_yellow', 256, 64, 2, 0.5, 0.8, 0, (c, _e, w, h, rng) => {
    c.fillStyle = '#d7b43a';
    c.fillRect(0, 0, w, h);
    noise(c, w, h, rng, 0.2, 900);
    stains(c, w, h, rng, 4, 'rgba(90,80,50,A)', 0.45);
  });
  add('curb_white', 256, 64, 2, 0.5, 0.8, 0, (c, _e, w, h, rng) => {
    for (let x = 0; x < w; x += 64) {
      c.fillStyle = (x / 64) % 2 ? '#1e1e1e' : '#e4e2dc';
      c.fillRect(x, 0, 64, h);
    }
    noise(c, w, h, rng, 0.18, 800);
  });
  add('plaster_plain', 256, 256, 4, 4, 0.92, 0, (c, _e, w, h, rng) => plaster(c, w, h, '#ddd3bf', rng));
  add('metal_dark', 128, 128, 2, 2, 0.45, 0.8, (c, _e, w, h, rng) => {
    c.fillStyle = '#2a2b2d';
    c.fillRect(0, 0, w, h);
    noise(c, w, h, rng, 0.1, 400);
  });
  add('pillar_light', 64, 64, 0.5, 0.5, 0.5, 0, (c, e, w, h) => {
    c.fillStyle = '#fff2c8';
    c.fillRect(0, 0, w, h);
    e.fillStyle = '#ffd98a';
    e.fillRect(0, 0, w, h);
  });
  add('glass_dark', 128, 128, 2, 2, 0.1, 0.5, (c, _e, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#3d5566');
    g.addColorStop(1, '#1c2a33');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
  add('ballast', 256, 256, 3, 3, 0.95, 0, (c, _e, w, h, rng) => {
    c.fillStyle = '#6f675c';
    c.fillRect(0, 0, w, h);
    noise(c, w, h, rng, 0.35, 9000, 2.5);
    // sleepers
    for (let y = 0; y < h; y += 43) {
      c.fillStyle = '#5a4a3a';
      c.fillRect(w * 0.12, y, w * 0.76, 16);
    }
  });
  add('dome_white', 128, 128, 2, 2, 0.6, 0, (c, _e, w, h, rng) => plaster(c, w, h, '#f1efe8', rng, 0.4));
  add('marble', 256, 256, 3, 3, 0.35, 0, (c, _e, w, h, rng) => {
    c.fillStyle = '#e9e4da';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(120,110,100,0.25)';
    for (let i = 0; i < 20; i++) {
      c.beginPath();
      c.moveTo(rng.next() * w, rng.next() * h);
      c.bezierCurveTo(rng.next() * w, rng.next() * h, rng.next() * w, rng.next() * h, rng.next() * w, rng.next() * h);
      c.stroke();
    }
    c.strokeStyle = 'rgba(0,0,0,0.1)';
    for (let x = 0; x < w; x += 64) c.strokeRect(x, 0, 64, 64);
  });
  return defs.sort((a, b) => b.h - a.h);
}

function brick(c: CanvasRenderingContext2D, w: number, h: number, rng: RNG, base: string) {
  c.fillStyle = '#b8ab98';
  c.fillRect(0, 0, w, h);
  const bh = 8, bw = 22;
  for (let y = 0, row = 0; y < h; y += bh, row++)
    for (let x = row % 2 ? -bw / 2 : 0; x < w; x += bw) {
      c.fillStyle = shade(base, rng.range(0.82, 1.12));
      c.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  noise(c, w, h, rng, 0.08, 1500);
}

function roofTiles(c: CanvasRenderingContext2D, w: number, h: number, rng: RNG, base: string) {
  c.fillStyle = shade(base, 0.7);
  c.fillRect(0, 0, w, h);
  for (let y = 0, row = 0; y < h; y += 16, row++)
    for (let x = row % 2 ? -12 : 0; x < w; x += 24) {
      const g = c.createLinearGradient(0, y, 0, y + 16);
      g.addColorStop(0, shade(base, rng.range(1.0, 1.2)));
      g.addColorStop(1, shade(base, 0.75));
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x + 12, y + 8, 11, 9, 0, 0, Math.PI);
      c.fill();
    }
  noise(c, w, h, rng, 0.08, 1500);
}

function grass(c: CanvasRenderingContext2D, w: number, h: number, rng: RNG, rgb: [number, number, number], dry = false) {
  c.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < (w * h) / 5; i++) {
    const f = rng.range(0.7, 1.25);
    c.fillStyle = `rgba(${Math.round(rgb[0] * f)},${Math.round(rgb[1] * f)},${Math.round(rgb[2] * f * 0.9)},0.6)`;
    const x = rng.next() * w, y = rng.next() * h;
    c.fillRect(x, y, 1.5, rng.range(2, 5));
  }
  if (dry) {
    for (let i = 0; i < 40; i++) {
      const x = rng.next() * w, y = rng.next() * h, r = rng.range(10, 40);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(150,130,95,0.55)');
      g.addColorStop(1, 'rgba(150,130,95,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  } else {
    for (let i = 0; i < 25; i++) {
      const x = rng.next() * w, y = rng.next() * h, r = rng.range(15, 50);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rng.next() < 0.5 ? '60,100,35' : '120,140,70'},0.25)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}
