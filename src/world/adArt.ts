// Billboard artwork: 16 invented advertising campaigns (no real brands) drawn with canvas at 1024×512 each.
// Each one is a small illustrated scene (sunset road, skyline, neon, plane over clouds …) with a bold headline,
// the way a real roadside poster is laid out. The billboard shader cycles through them like a digital screen.
import { RNG } from '../core/rng';

export const AD_W = 1024, AD_H = 512;
type C = CanvasRenderingContext2D;
type Painter = (c: C, W: number, H: number, rng: RNG) => void;

interface Ad {
  brand: string;
  line: string;
  sub: string;
  fg: string;
  accent: string;
  scene: Painter;
  /** text block alignment */
  right?: boolean;
}

const grad = (c: C, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [t, col] of stops) g.addColorStop(t, col);
  return g;
};
const glow = (c: C, x: number, y: number, r: number, col: string, a = 1) => {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.save();
  c.globalAlpha = a;
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.restore();
};
const mountains = (c: C, W: number, y: number, h: number, col: string, rng: RNG, rough = 0.5) => {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(0, y + h);
  let py = y;
  for (let x = 0; x <= W; x += 24) {
    py += (rng.next() - 0.5) * h * rough;
    py = Math.max(y - h * 0.5, Math.min(y + h * 0.4, py));
    c.lineTo(x, py);
  }
  c.lineTo(W, y + h * 2);
  c.lineTo(0, y + h * 2);
  c.fill();
};
const car = (c: C, x: number, y: number, s: number, body: string) => {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(-150, 0);
  c.bezierCurveTo(-150, -30, -120, -38, -90, -42);
  c.bezierCurveTo(-60, -80, -20, -92, 30, -90);
  c.bezierCurveTo(70, -88, 100, -60, 118, -40);
  c.bezierCurveTo(150, -34, 160, -20, 160, 0);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(20,30,50,0.85)';
  c.beginPath();
  c.moveTo(-70, -42);
  c.bezierCurveTo(-48, -72, -10, -82, 28, -80);
  c.bezierCurveTo(60, -78, 84, -62, 98, -42);
  c.closePath();
  c.fill();
  c.fillStyle = '#0b0b0e';
  for (const wx of [-88, 92]) {
    c.beginPath();
    c.arc(wx, 2, 27, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#9aa3ad';
    c.beginPath();
    c.arc(wx, 2, 12, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#0b0b0e';
  }
  c.restore();
};
const skyline = (c: C, W: number, base: number, col: string, rng: RNG, litCol = '#ffd98a', lit = 0.25) => {
  for (let x = 0; x < W; x += 0) {
    const w = rng.range(30, 70), h = rng.range(60, 230);
    c.fillStyle = col;
    c.fillRect(x, base - h, w, h);
    for (let wy = base - h + 8; wy < base - 10; wy += 14)
      for (let wx = x + 5; wx < x + w - 8; wx += 11)
        if (rng.next() < lit) {
          c.fillStyle = litCol;
          c.fillRect(wx, wy, 5, 7);
        }
    x += w + rng.range(2, 8);
  }
};
const cloud = (c: C, x: number, y: number, s: number, a = 0.9) => {
  c.save();
  c.globalAlpha = a;
  c.fillStyle = '#fff';
  for (const [dx, dy, r] of [[0, 0, 46], [52, -14, 56], [112, 0, 44], [60, 14, 48], [22, 14, 36]]) {
    c.beginPath();
    c.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
};

const evScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, 0, H, [[0, '#2b1b4f'], [0.45, '#ff7a45'], [0.62, '#ffd08a'], [0.63, '#1b1530'], [1, '#0a0812']]);
  c.fillRect(0, 0, W, H);
  glow(c, W * 0.72, H * 0.6, 260, 'rgba(255,200,120,0.9)');
  mountains(c, W, H * 0.58, 70, '#2a1a3d', rng, 0.7);
  c.fillStyle = '#0c0a14';
  c.beginPath();
  c.moveTo(W * 0.3, H);
  c.lineTo(W * 0.68, H * 0.6);
  c.lineTo(W * 0.78, H * 0.6);
  c.lineTo(W * 1.05, H);
  c.fill();
  c.strokeStyle = 'rgba(255,230,180,0.8)';
  c.lineWidth = 4;
  c.setLineDash([26, 30]);
  c.beginPath();
  c.moveTo(W * 0.54, H);
  c.lineTo(W * 0.73, H * 0.6);
  c.stroke();
  c.setLineDash([]);
  car(c, W * 0.66, H * 0.86, 1.25, '#e8edf2');
  glow(c, W * 0.66 + 190, H * 0.86 - 30, 70, 'rgba(120,200,255,0.9)');
};
const streamScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, W, H, [[0, '#14041f'], [1, '#3a0a3f']]);
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) glow(c, rng.range(0, W), rng.range(0, H), rng.range(30, 110), ['rgba(255,60,120,.8)', 'rgba(70,120,255,.8)', 'rgba(255,170,60,.7)'][i % 3], 0.35);
  c.fillStyle = 'rgba(255,255,255,0.92)';
  const cx = W * 0.78, cy = H * 0.5;
  c.beginPath();
  c.arc(cx, cy, 92, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#3a0a3f';
  c.beginPath();
  c.moveTo(cx - 28, cy - 48);
  c.lineTo(cx - 28, cy + 48);
  c.lineTo(cx + 52, cy);
  c.fill();
};
const bankScene: Painter = (c, W, H) => {
  c.fillStyle = grad(c, 0, 0, W, H, [[0, '#f4f8ff'], [1, '#bcd3f5']]);
  c.fillRect(0, 0, W, H);
  c.strokeStyle = '#0c4aa6';
  c.lineWidth = 12;
  c.lineJoin = 'round';
  c.beginPath();
  const pts = [[0.42, 0.82], [0.52, 0.7], [0.6, 0.76], [0.7, 0.5], [0.8, 0.56], [0.95, 0.24]];
  pts.forEach(([x, y], i) => (i ? c.lineTo(W * x, H * y) : c.moveTo(W * x, H * y)));
  c.stroke();
  c.fillStyle = 'rgba(12,74,166,0.12)';
  c.lineTo(W * 0.95, H);
  c.lineTo(W * 0.42, H);
  c.fill();
  c.fillStyle = '#0c4aa6';
  c.beginPath();
  c.arc(W * 0.95, H * 0.24, 16, 0, Math.PI * 2);
  c.fill();
};
const energyScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, 0, H, [[0, '#04120a'], [1, '#0b2b12']]);
  c.fillRect(0, 0, W, H);
  glow(c, W * 0.75, H * 0.5, 300, 'rgba(120,255,60,0.7)');
  c.fillStyle = '#c7ff3d';
  c.beginPath();
  const bx = W * 0.72, by = H * 0.1;
  c.moveTo(bx + 60, by);
  c.lineTo(bx - 70, by + 230);
  c.lineTo(bx + 5, by + 230);
  c.lineTo(bx - 40, by + 420);
  c.lineTo(bx + 120, by + 170);
  c.lineTo(bx + 40, by + 170);
  c.closePath();
  c.fill();
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(200,255,100,${rng.range(0.1, 0.5)})`;
    c.fillRect(rng.range(W * 0.45, W), rng.range(0, H), rng.range(2, 6), rng.range(10, 60));
  }
};
const foodScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, W, H, [[0, '#ffb43a'], [1, '#e8542a']]);
  c.fillRect(0, 0, W, H);
  glow(c, W * 0.74, H * 0.5, 280, 'rgba(255,240,170,.8)');
  const cx = W * 0.74, cy = H * 0.52;
  c.fillStyle = '#fff4dd';
  c.beginPath();
  c.arc(cx, cy, 200, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#e8b04a';
  c.beginPath();
  c.ellipse(cx, cy + 10, 150, 78, -0.2, 0, Math.PI * 2);
  c.fill();
  for (let i = 0; i < 40; i++) {
    c.fillStyle = ['#4d9a2a', '#d12d1c', '#fff2b0'][i % 3];
    c.beginPath();
    c.arc(cx + rng.range(-120, 120), cy + rng.range(-40, 50), rng.range(5, 12), 0, Math.PI * 2);
    c.fill();
  }
};
const phoneScene: Painter = (c, W, H) => {
  c.fillStyle = grad(c, 0, 0, W, H, [[0, '#0b1020'], [1, '#27407a']]);
  c.fillRect(0, 0, W, H);
  glow(c, W * 0.74, H * 0.5, 320, 'rgba(120,170,255,.7)');
  const x = W * 0.66, y = H * 0.1, w = 190, h = 390;
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate(0.12);
  c.fillStyle = '#d6dbe3';
  c.beginPath();
  c.roundRect(-w / 2, -h / 2, w, h, 30);
  c.fill();
  c.fillStyle = grad(c, 0, -h / 2, 0, h / 2, [[0, '#ff4f8b'], [0.5, '#7a4dff'], [1, '#18b6ff']]);
  c.beginPath();
  c.roundRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16, 24);
  c.fill();
  c.restore();
};
const realtyScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, 0, H, [[0, '#3a4a7a'], [0.5, '#f6a96a'], [0.75, '#ffd7a0'], [0.76, '#14192b'], [1, '#0a0d18']]);
  c.fillRect(0, 0, W, H);
  skyline(c, W * 1.02, H * 0.8, '#161b2e', rng, '#ffd98a', 0.35);
  c.fillStyle = '#ffffff';
  c.globalAlpha = 0.9;
  c.fillRect(W * 0.62, H * 0.2, 220, 8);
  c.globalAlpha = 1;
};
const airScene: Painter = (c, W, H) => {
  c.fillStyle = grad(c, 0, 0, 0, H, [[0, '#2b79e8'], [1, '#bfe3ff']]);
  c.fillRect(0, 0, W, H);
  cloud(c, W * 0.55, H * 0.72, 1.6);
  cloud(c, W * 0.8, H * 0.82, 1.2, 0.8);
  cloud(c, W * 0.35, H * 0.9, 1.4, 0.7);
  c.save();
  c.translate(W * 0.75, H * 0.38);
  c.rotate(-0.28);
  c.fillStyle = '#f4f6fa';
  c.beginPath();
  c.ellipse(0, 0, 150, 24, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#d3d9e2';
  c.beginPath();
  c.moveTo(-10, 0);
  c.lineTo(40, 100);
  c.lineTo(70, 100);
  c.lineTo(40, 0);
  c.fill();
  c.beginPath();
  c.moveTo(-120, -5);
  c.lineTo(-150, -70);
  c.lineTo(-125, -70);
  c.lineTo(-85, -5);
  c.fill();
  c.restore();
};
const festScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, 0, H, [[0, '#12001f'], [1, '#380f5c']]);
  c.fillRect(0, 0, W, H);
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    c.strokeStyle = ['rgba(255,60,200,.55)', 'rgba(60,200,255,.55)', 'rgba(255,230,60,.4)'][i % 3];
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(W * (0.45 + i * 0.07), 0);
    c.lineTo(W * (0.2 + i * 0.1), H);
    c.stroke();
  }
  c.restore();
  c.fillStyle = '#07000c';
  for (let x = 0; x < W; x += 18) {
    const h = rng.range(40, 100);
    c.beginPath();
    c.arc(x + 8, H - h + 10, 14, 0, Math.PI * 2);
    c.fill();
    c.fillRect(x - 2, H - h + 20, 22, h);
  }
};
const coffeeScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, W, H, [[0, '#f3e6d0'], [1, '#d3b48a']]);
  c.fillRect(0, 0, W, H);
  const cx = W * 0.76, cy = H * 0.62;
  c.fillStyle = '#fff';
  c.beginPath();
  c.ellipse(cx, cy + 90, 190, 46, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(cx - 105, cy - 70);
  c.lineTo(cx + 105, cy - 70);
  c.lineTo(cx + 85, cy + 80);
  c.lineTo(cx - 85, cy + 80);
  c.fill();
  c.fillStyle = '#4a2a14';
  c.beginPath();
  c.ellipse(cx, cy - 70, 105, 22, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.7)';
  c.lineWidth = 8;
  c.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    c.beginPath();
    c.moveTo(cx - 40 + k * 40, cy - 100);
    c.bezierCurveTo(cx - 70 + k * 40, cy - 160, cx - 10 + k * 40, cy - 200, cx - 40 + k * 40 + rng.range(-10, 10), cy - 260);
    c.stroke();
  }
};
const shoeScene: Painter = (c, W, H) => {
  c.fillStyle = '#ff3b2f';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#111';
  c.beginPath();
  c.moveTo(W * 0.5, 0);
  c.lineTo(W * 0.72, 0);
  c.lineTo(W * 0.5, H);
  c.lineTo(W * 0.28, H);
  c.fill();
  c.save();
  c.translate(W * 0.74, H * 0.58);
  c.rotate(-0.12);
  c.fillStyle = '#fff';
  c.beginPath();
  c.moveTo(-170, 30);
  c.bezierCurveTo(-170, -30, -100, -40, -60, -70);
  c.bezierCurveTo(-20, -110, 40, -80, 70, -40);
  c.bezierCurveTo(130, -30, 190, 0, 190, 40);
  c.lineTo(-170, 56);
  c.fill();
  c.fillStyle = '#ffcf1f';
  c.fillRect(-172, 40, 364, 30);
  c.restore();
};
const fitScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, W, H, [[0, '#111'], [1, '#1d2b3a']]);
  c.fillRect(0, 0, W, H);
  glow(c, W * 0.75, H * 0.45, 300, 'rgba(255,90,40,.6)');
  c.fillStyle = '#05080c';
  const cx = W * 0.75;
  c.beginPath();
  c.arc(cx, H * 0.3, 44, 0, Math.PI * 2);
  c.fill();
  c.fillRect(cx - 70, H * 0.37, 140, 190);
  c.fillRect(cx - 190, H * 0.45, 380, 30);
  c.fillRect(cx - 215, H * 0.4, 20, 130);
  c.fillRect(cx + 195, H * 0.4, 20, 130);
  for (let i = 0; i < 30; i++) {
    c.fillStyle = `rgba(255,150,80,${rng.range(0.1, 0.5)})`;
    c.fillRect(rng.range(0, W), rng.range(0, H), 3, 3);
  }
};
const beachScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, 0, H, [[0, '#4cc3ff'], [0.55, '#bff0ff'], [0.56, '#1ba0c8'], [0.8, '#0b6e96'], [0.81, '#f5dca0'], [1, '#e0b872']]);
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#ffe14a';
  c.beginPath();
  c.arc(W * 0.8, H * 0.2, 54, 0, Math.PI * 2);
  c.fill();
  glow(c, W * 0.8, H * 0.2, 160, 'rgba(255,240,150,.6)');
  for (let k = 0; k < 5; k++) {
    c.fillStyle = '#3e2a1a';
    c.fillRect(W * 0.66 + k * 70, H * 0.55, 8, 150);
    c.fillStyle = '#1f7a3a';
    for (let a = 0; a < 6; a++) {
      c.save();
      c.translate(W * 0.66 + k * 70 + 4, H * 0.55);
      c.rotate(-1.2 + a * 0.5 + rng.range(-0.1, 0.1));
      c.fillRect(0, -3, 70, 6);
      c.restore();
    }
  }
};
const nightCityScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, 0, H, [[0, '#050818'], [1, '#1c1040']]);
  c.fillRect(0, 0, W, H);
  skyline(c, W * 1.02, H * 0.92, '#0b0e22', rng, '#7fd1ff', 0.3);
  glow(c, W * 0.8, H * 0.3, 240, 'rgba(160,100,255,.6)');
  c.fillStyle = '#fff';
  c.globalAlpha = 0.9;
  for (let i = 0; i < 60; i++) c.fillRect(rng.range(0, W), rng.range(0, H * 0.5), 2, 2);
  c.globalAlpha = 1;
};
const medScene: Painter = (c, W, H) => {
  c.fillStyle = grad(c, 0, 0, W, H, [[0, '#e8fbff'], [1, '#a5e6f0']]);
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#0aa3c2';
  c.fillRect(W * 0.78 - 28, H * 0.2, 56, 190);
  c.fillRect(W * 0.78 - 95, H * 0.2 + 67, 190, 56);
  c.strokeStyle = 'rgba(10,163,194,.25)';
  c.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    c.arc(W * 0.78, H * 0.45, 140 + i * 40, 0, Math.PI * 2);
    c.stroke();
  }
};
const roadScene: Painter = (c, W, H, rng) => {
  c.fillStyle = grad(c, 0, 0, 0, H, [[0, '#ffcf6a'], [0.5, '#ff8a3a'], [0.51, '#2a1608'], [1, '#150a03']]);
  c.fillRect(0, 0, W, H);
  mountains(c, W, H * 0.5, 60, '#4a2a12', rng, 0.5);
  c.fillStyle = '#1b0f06';
  c.beginPath();
  c.moveTo(W * 0.55, H);
  c.lineTo(W * 0.74, H * 0.5);
  c.lineTo(W * 0.78, H * 0.5);
  c.lineTo(W * 1.1, H);
  c.fill();
  glow(c, W * 0.76, H * 0.5, 240, 'rgba(255,230,150,.9)');
};

const ADS: Ad[] = [
  { brand: 'VOLTA', line: 'THE FUTURE DRIVES ITSELF', sub: 'All-electric · 520 mi range', fg: '#ffffff', accent: '#7fd8ff', scene: evScene },
  { brand: 'NOVA+', line: 'WATCH WHAT’S NEXT', sub: 'First month free', fg: '#ffffff', accent: '#ff5c9a', scene: streamScene },
  { brand: 'PACIFIC TRUST', line: 'BANK LIKE IT’S 2030', sub: 'No fees. No fine print.', fg: '#0b2a5c', accent: '#0c4aa6', scene: bankScene },
  { brand: 'SURGE', line: 'CHARGE YOUR NIGHT', sub: 'Zero sugar energy', fg: '#e8ffb0', accent: '#c7ff3d', scene: energyScene },
  { brand: 'LA TACO CO.', line: 'FRESH OFF THE GRILL', sub: 'Open till 3 AM', fg: '#fff7e6', accent: '#2a0d00', scene: foodScene },
  { brand: 'AURA 12', line: 'SEE EVERYTHING', sub: 'The camera that never blinks', fg: '#ffffff', accent: '#9ac2ff', scene: phoneScene },
  { brand: 'SKYLINE LIVING', line: 'LIVE ABOVE IT ALL', sub: 'Penthouses from $890K', fg: '#fff2dc', accent: '#ffd08a', scene: realtyScene },
  { brand: 'ZEPHYR AIR', line: 'WHEELS UP. WORRIES DOWN.', sub: 'LAX → anywhere', fg: '#ffffff', accent: '#ffffff', scene: airScene },
  { brand: 'HELIOS FEST', line: 'THREE NIGHTS. ONE SKY.', sub: 'Tickets on sale now', fg: '#ffffff', accent: '#ffe83c', scene: festScene },
  { brand: 'MAISON NOIR', line: 'WAKE UP WELL', sub: 'Small-batch roasters', fg: '#3a2210', accent: '#6b3f1d', scene: coffeeScene },
  { brand: 'STRIDE', line: 'RUN THE CITY', sub: 'New season. New speed.', fg: '#ffffff', accent: '#ffcf1f', scene: shoeScene },
  { brand: 'IRONWORKS', line: 'NO EXCUSES', sub: '24/7 gyms · Join today', fg: '#ffffff', accent: '#ff6a2a', scene: fitScene },
  { brand: 'SUNSET COAST', line: 'ESCAPE TO THE WATER', sub: 'Resorts from $129/night', fg: '#ffffff', accent: '#fff2a0', scene: beachScene },
  { brand: 'NIGHTSHIFT', line: 'THE CITY NEVER CLOSES', sub: 'Rooftop · Live DJs · Fri-Sun', fg: '#ffffff', accent: '#9a7bff', scene: nightCityScene },
  { brand: 'CITY CARE', line: 'HEALTH, SIMPLIFIED', sub: 'Same-day appointments', fg: '#05505f', accent: '#0aa3c2', scene: medScene },
  { brand: 'ROUTE 66 MOTORS', line: 'ROADS WORTH TAKING', sub: 'Certified pre-owned', fg: '#fff3dc', accent: '#ffd08a', scene: roadScene },
];

export function drawAd(c: C, x: number, y: number, i: number): void {
  const ad = ADS[i % ADS.length];
  const rng = new RNG(900 + i * 17);
  c.save();
  c.translate(x, y);
  c.beginPath();
  c.rect(0, 0, AD_W, AD_H);
  c.clip();
  ad.scene(c, AD_W, AD_H, rng);
  // legibility scrim behind the text
  const s = c.createLinearGradient(0, 0, AD_W * 0.62, 0);
  s.addColorStop(0, 'rgba(0,0,0,0.38)');
  s.addColorStop(1, 'rgba(0,0,0,0)');
  if (ad.fg !== '#0b2a5c' && ad.fg !== '#3a2210' && ad.fg !== '#05505f') {
    c.fillStyle = s;
    c.fillRect(0, 0, AD_W, AD_H);
  }
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = ad.accent;
  c.font = '800 38px "Avenir Next Condensed", "Arial Narrow", Impact, sans-serif';
  (c as unknown as { letterSpacing: string }).letterSpacing = '6px';
  c.fillText(ad.brand, 52, 92);
  (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
  c.fillStyle = ad.fg;
  let size = 112;
  const font = (n: number) => `900 ${n}px Impact, "Arial Black", "Avenir Next Condensed", sans-serif`;
  c.font = font(size);
  const words = ad.line.split(' ');
  const lines: string[] = [];
  const maxW = AD_W * 0.56;
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  lines.push(cur);
  while (lines.some((l) => c.measureText(l).width > maxW) && size > 40) {
    size -= 4;
    c.font = font(size);
  }
  lines.forEach((l, k) => c.fillText(l, 50, 190 + k * size * 0.98));
  c.font = '600 34px "Avenir Next", "Segoe UI", Arial, sans-serif';
  c.fillStyle = ad.fg;
  c.globalAlpha = 0.9;
  c.fillText(ad.sub, 54, AD_H - 62);
  c.globalAlpha = 1;
  // thin accent rule
  c.fillStyle = ad.accent;
  c.fillRect(54, AD_H - 44, 120, 6);
  c.restore();
}
