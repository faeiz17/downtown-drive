// GTA-style circular minimap drawn from the OSM world data: rotates with heading, road hierarchy, parks,
// buildings, water, real street names, traffic dots, signals. © OpenStreetMap contributors.
import type { WorldData } from '../data/types';
import { SpatialGrid, cumulative, sampleAt } from '../core/geom2d';
import { ROAD_CLASSES } from '../data/roadClasses';

const ROAD_COLORS: Record<string, string> = {
  trunk: '#f3c46b',
  primary: '#f5d27a',
  secondary: '#f0e6a8',
  tertiary: '#e9e9e9',
  link: '#e0e0e0',
  residential: '#c9c9c9',
  service: '#b0b0b0',
};

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokeGrid = new SpatialGrid<number>(120);
  private areaGrid = new SpatialGrid<number>(150);
  private bldGrid = new SpatialGrid<number>(100);
  private labels: { name: string; stroke: number; s: number; rank: number }[] = [];
  private labelGrid = new SpatialGrid<number>(150);
  private size: number;
  range = 230; // metres from centre to edge
  private timer = 0;

  constructor(private world: WorldData, size = 230) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    world.strokes.forEach((st, i) => {
      const b = bbox(st.pts);
      this.strokeGrid.insert(i, b[0], b[1], b[2], b[3]);
      // label anchors every ~220 m along named major-ish roads
      if (!st.name) return;
      const cum = cumulative(st.pts);
      const L = cum[cum.length - 1];
      if (L < 60) return;
      const rank = ROAD_CLASSES[st.cls].rank;
      const step = rank >= 3 ? 200 : 260;
      for (let s = Math.min(L / 2, step / 2); s < L; s += step) {
        const p = sampleAt(st.pts, cum, s);
        const li = this.labels.push({ name: st.name, stroke: i, s, rank }) - 1;
        this.labelGrid.insertPoint(li, p.x, p.z);
      }
    });
    world.areas.forEach((a, i) => {
      const b = bbox(a.pts);
      this.areaGrid.insert(i, b[0], b[1], b[2], b[3]);
    });
    world.buildings.forEach((bd, i) => {
      const b = bbox(bd.pts);
      this.bldGrid.insert(i, b[0], b[1], b[2], b[3]);
    });
  }

  /** heading: car yaw (atan2(fx, fz)); map rotates so the car points up. */
  draw(dt: number, x: number, z: number, heading: number, traffic: { x: number; z: number }[], zoomOut: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 30;
    const c = this.ctx, S = this.size, R = S / 2;
    const range = this.range * (1 + zoomOut);
    const k = R / range;
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#5d6b58';
    c.fillRect(0, 0, S, S);
    c.translate(R, R);
    // world → map: rotate so heading points up. World X east, Z south. Screen: x right, y down.
    // Rotating (dx, dz) by θ maps the car's forward (sin h, cos h) to (sin(h−θ), cos(h−θ)); for it to point up
    // (0, −1) we need θ = h − π.
    const th = heading - Math.PI;
    const cs = Math.cos(th), sn = Math.sin(th);
    const T = (wx: number, wz: number): [number, number] => {
      const dx = (wx - x) * k, dz = (wz - z) * k;
      return [dx * cs - dz * sn, dx * sn + dz * cs];
    };
    const r2 = range * 1.45;
    // areas
    for (const i of this.areaGrid.queryRadius(x, z, r2)) {
      const a = this.world.areas[i];
      c.fillStyle = a.kind === 'water' ? '#4a7fa8' : a.kind === 'parking' || a.kind === 'plaza' ? '#6b6f6a' : a.kind === 'campus' ? '#6f7a62' : '#4f7d45';
      poly(c, a.pts, T, true);
    }
    // water lines
    c.strokeStyle = '#4a7fa8';
    for (const w of this.world.water) {
      c.lineWidth = Math.max(2, w.width * k);
      line(c, w.pts, T);
    }
    // buildings
    c.fillStyle = 'rgba(40,40,40,0.35)';
    for (const i of this.bldGrid.queryRadius(x, z, r2)) poly(c, this.world.buildings[i].pts, T, true);
    // roads: casing then fill, minor → major
    const strokes = this.strokeGrid.queryRadius(x, z, r2).map((i) => this.world.strokes[i]);
    strokes.sort((a, b) => ROAD_CLASSES[a.cls].rank - ROAD_CLASSES[b.cls].rank);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const st of strokes) {
      c.strokeStyle = 'rgba(20,20,20,0.7)';
      c.lineWidth = Math.max(2.2, st.width * k + 2);
      line(c, st.pts, T);
    }
    for (const st of strokes) {
      c.strokeStyle = ROAD_COLORS[st.cls];
      c.lineWidth = Math.max(1.4, st.width * k);
      line(c, st.pts, T);
    }
    // signals
    c.fillStyle = '#ff5a4a';
    for (const n of this.world.nodes) {
      if (n.signal === undefined) continue;
      if (Math.abs(n.x - x) > r2 || Math.abs(n.z - z) > r2) continue;
      const [px, py] = T(n.x, n.z);
      c.fillRect(px - 1.5, py - 1.5, 3, 3);
    }
    // traffic
    c.fillStyle = 'rgba(255,255,255,0.85)';
    for (const t of traffic) {
      const [px, py] = T(t.x, t.z);
      if (px * px + py * py > R * R) continue;
      c.beginPath();
      c.arc(px, py, 1.8, 0, Math.PI * 2);
      c.fill();
    }
    // street names (upright, along the road, de-duplicated)
    const shown = new Set<string>();
    const boxes: number[][] = [];
    const cand = this.labelGrid.queryRadius(x, z, range * 1.1).map((i) => this.labels[i]).sort((a, b) => b.rank - a.rank);
    c.font = '600 10px "Segoe UI", Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const lb of cand) {
      if (shown.has(lb.name)) continue;
      const st = this.world.strokes[lb.stroke];
      const cum = cumulative(st.pts);
      const p = sampleAt(st.pts, cum, lb.s);
      const [px, py] = T(p.x, p.z);
      if (px * px + py * py > (R - 18) * (R - 18)) continue;
      const [ax, ay] = T(p.x + p.tx, p.z + p.tz);
      let ang = Math.atan2(ay - py, ax - px);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      const w = c.measureText(lb.name).width + 6;
      const box = [px - w / 2, py - 7, px + w / 2, py + 7];
      if (boxes.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      boxes.push(box);
      shown.add(lb.name);
      c.save();
      c.translate(px, py);
      c.rotate(ang);
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,0.75)';
      c.strokeText(lb.name, 0, 0);
      c.fillStyle = '#ffffff';
      c.fillText(lb.name, 0, 0);
      c.restore();
      if (shown.size > 6) break;
    }
    c.restore();
    // player arrow (always pointing up)
    c.save();
    c.translate(R, R);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#1d3658';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6.5, 7);
    c.lineTo(0, 3.5);
    c.lineTo(-6.5, 7);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    // north marker on the rim: world north (0, −1) through the same rotation
    const px = R + sn * (R - 11), py = R - cs * (R - 11);
    c.fillStyle = '#1d1d1d';
    c.beginPath();
    c.arc(px, py, 8, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff';
    c.font = 'bold 10px Arial';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', px, py + 0.5);
    // rim
    c.strokeStyle = 'rgba(0,0,0,0.8)';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.stroke();
  }
}

function bbox(p: number[]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    a = Math.min(a, p[i]);
    c = Math.max(c, p[i]);
    b = Math.min(b, p[i + 1]);
    d = Math.max(d, p[i + 1]);
  }
  return [a, b, c, d];
}

function line(c: CanvasRenderingContext2D, pts: number[], T: (x: number, z: number) => [number, number]) {
  c.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const [px, py] = T(pts[i], pts[i + 1]);
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.stroke();
}

function poly(c: CanvasRenderingContext2D, pts: number[], T: (x: number, z: number) => [number, number], fill: boolean) {
  c.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const [px, py] = T(pts[i], pts[i + 1]);
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
  if (fill) c.fill();
  else c.stroke();
}
