// Shop signboards (real OSM shop names where available) and roadside billboard adverts (invented brands).
import * as THREE from 'three';
import { RNG, hash32 } from '../core/rng';

export const SIGN_COLS = 4, SIGN_ROWS = 32, SIGN_COUNT = SIGN_COLS * SIGN_ROWS;
const SW = 512, SH = 64;

const GENERIC_NAMES = [
  'Al-Madina Traders', 'Lahore Mobile Centre', 'Punjab Sweets & Bakers', 'Butt Karahi', 'Shan Electronics', 'Hafiz Cloth House',
  'Al-Rehman Pharmacy', 'Gulberg Opticians', 'Chaudhry Motors', 'Star Tailors', 'New Kashmir Dry Cleaners', 'Madni General Store',
  'Royal Shoes', 'Bismillah Hardware', 'City Boutique', 'Crown Jewellers', 'Liberty Bags', 'Café Chai Khana', 'Rizwan Book Depot',
  'Sheikh Carpets', 'Lahori Nashta', 'Afzal Electronics', 'Zam Zam Juice Corner', 'Friends Photo Studio', 'Iqbal Paints',
  'Model Town Travels', 'Qureshi Kebab House', 'Noor Fabrics', 'Awan Property Advisors', 'Faisal Mobiles', 'Taj Furniture',
  'Mughal Handicrafts', 'Sadiq Sanitary Store', 'Khan Tyres', 'Al-Fateh Stationers', 'Ravi Computers', 'Peshawari Chappal',
  'Rehmat Fruit Shop', 'Anarkali Lawn House', 'Karachi Biryani', 'Desi Dhaba', 'Bhatti Auto Parts', 'Ali Watch Co.',
];
const URDU = ['دکان', 'مارکیٹ', 'سویٹس', 'ٹریڈرز', 'موبائل', 'فارمیسی', 'کپڑا', 'ہوٹل', 'بیکرز', 'الیکٹرونکس'];

export class Signage {
  signTexture!: THREE.CanvasTexture;
  adTexture!: THREE.CanvasTexture;
  private names: string[] = [];
  private index = new Map<string, number>();

  build(realNames: string[]): void {
    const uniq = [...new Set(realNames.map((n) => n.trim()).filter((n) => n.length >= 3 && n.length <= 30))];
    const rng = new RNG(99);
    // up to ~70% real names, rest generic
    const real = uniq.slice(0, Math.floor(SIGN_COUNT * 0.7));
    this.names = real.concat(GENERIC_NAMES).slice(0, SIGN_COUNT);
    while (this.names.length < SIGN_COUNT) this.names.push(rng.pick(GENERIC_NAMES) + ' ' + (this.names.length % 9 + 1));
    this.names.forEach((n, i) => this.index.set(n, i));

    const c = document.createElement('canvas');
    c.width = SW * SIGN_COLS;
    c.height = SH * SIGN_ROWS;
    const ctx = c.getContext('2d')!;
    this.names.forEach((name, i) => drawSign(ctx, (i % SIGN_COLS) * SW, Math.floor(i / SIGN_COLS) * SH, name, new RNG(hash32(name))));
    this.signTexture = new THREE.CanvasTexture(c);
    this.signTexture.colorSpace = THREE.SRGBColorSpace;
    this.signTexture.anisotropy = 8;

    const a = document.createElement('canvas');
    a.width = 2048;
    a.height = 1024;
    const actx = a.getContext('2d')!;
    for (let i = 0; i < 16; i++) drawAd(actx, (i % 4) * 512, Math.floor(i / 4) * 256, i, new RNG(1000 + i));
    this.adTexture = new THREE.CanvasTexture(a);
    this.adTexture.colorSpace = THREE.SRGBColorSpace;
    this.adTexture.anisotropy = 8;
  }

  /** Sign index for a shop name (exact real name if present) or a stable generic pick from a seed. */
  signFor(name: string | undefined, seed: number): number {
    if (name && this.index.has(name.trim())) return this.index.get(name.trim())!;
    return (seed >>> 0) % SIGN_COUNT;
  }

  /** UV rect [u0, v0, u1, v1] of a sign cell (flipY texture: top row = v 1). */
  signUv(i: number): [number, number, number, number] {
    const col = i % SIGN_COLS, row = Math.floor(i / SIGN_COLS);
    const u0 = col / SIGN_COLS, u1 = (col + 1) / SIGN_COLS;
    const v1 = 1 - row / SIGN_ROWS, v0 = 1 - (row + 1) / SIGN_ROWS;
    const pu = 2 / (SW * SIGN_COLS), pv = 2 / (SH * SIGN_ROWS);
    return [u0 + pu, v0 + pv, u1 - pu, v1 - pv];
  }

  adUv(i: number): [number, number, number, number] {
    const col = i % 4, row = Math.floor(i / 4);
    return [col / 4 + 0.002, 1 - (row + 1) / 4 + 0.004, (col + 1) / 4 - 0.002, 1 - row / 4 - 0.004];
  }
}

function drawSign(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, rng: RNG) {
  const palettes = [
    ['#b3121b', '#ffffff', '#ffd400'], ['#0b3d91', '#ffffff', '#ffcc00'], ['#0f6b3a', '#ffffff', '#f5f5f5'], ['#111111', '#ffd400', '#ffffff'],
    ['#f2c200', '#1a1a1a', '#b3121b'], ['#ffffff', '#b3121b', '#0b3d91'], ['#5a1a6b', '#ffffff', '#ffd400'], ['#e65c00', '#ffffff', '#222'],
    ['#00796b', '#fff', '#ffe082'], ['#263238', '#80deea', '#fff'],
  ];
  const [bg, fg, acc] = rng.pick(palettes);
  const g = ctx.createLinearGradient(x, y, x, y + SH);
  g.addColorStop(0, bg);
  g.addColorStop(1, shadeHex(bg, 0.8));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, SW, SH);
  ctx.strokeStyle = acc;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 3, y + 3, SW - 6, SH - 6);
  const hasUrdu = rng.chance(0.45);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 40;
  const text = /[؀-ۿ]/.test(name) ? name : name.toUpperCase();
  ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  const maxW = SW * (hasUrdu ? 0.68 : 0.9);
  while (ctx.measureText(text).width > maxW && size > 14) {
    size -= 2;
    ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  }
  const cx = hasUrdu ? x + SW * 0.4 : x + SW / 2;
  ctx.fillText(text, cx, y + SH / 2 + 2);
  if (hasUrdu) {
    ctx.fillStyle = acc;
    ctx.font = `bold 30px "Noto Nastaliq Urdu", "Geeza Pro", "Segoe UI", Tahoma, sans-serif`;
    ctx.fillText(rng.pick(URDU), x + SW * 0.86, y + SH / 2);
  }
  // phone number strip
  if (rng.chance(0.3)) {
    ctx.fillStyle = acc;
    ctx.font = 'bold 11px Arial';
    ctx.fillText('0300-' + rng.int(1000000, 9999999), x + SW / 2, y + SH - 9);
  }
}

function shadeHex(hex: string, f: number): string {
  const n = parseInt(hex.slice(1).padEnd(6, '0'), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

const ADS: { title: string; sub: string; bg: [string, string]; fg: string; accent: string; urdu?: string; shape: 'circle' | 'bars' | 'wave' | 'phone' | 'bottle' | 'building' | 'sun' }[] = [
  { title: 'LAHORE COLA', sub: 'Thanda thanda, cool cool!', bg: ['#c40d1e', '#6d0610'], fg: '#fff', accent: '#ffd400', shape: 'bottle', urdu: 'ٹھنڈا ٹھنڈا' },
  { title: 'PAK TEL 5G', sub: 'Fastest network in Punjab', bg: ['#0a3d8f', '#021a44'], fg: '#fff', accent: '#39d0ff', shape: 'phone' },
  { title: 'Chai Premium', sub: 'Karak chai ka asli maza', bg: ['#6b3b12', '#2e1606'], fg: '#ffe7b0', accent: '#e8a13a', shape: 'circle', urdu: 'چائے' },
  { title: 'SKY TOWERS', sub: 'Luxury apartments · Gulberg III', bg: ['#1b2a3a', '#0b1119'], fg: '#fff', accent: '#d8b45a', shape: 'building' },
  { title: 'LAWN 2026', sub: 'Summer Collection · Flat 40% OFF', bg: ['#e84f86', '#8a1f4d'], fg: '#fff', accent: '#ffe0ef', shape: 'wave', urdu: 'سیل' },
  { title: 'Punjab Bank', sub: 'Aap ka apna bank', bg: ['#00703c', '#00341b'], fg: '#fff', accent: '#ffcf33', shape: 'bars' },
  { title: 'SOLAR PK', sub: 'Bijli ka bill? Zero!', bg: ['#ff9f1a', '#b35900'], fg: '#1a1a1a', accent: '#fff', shape: 'sun' },
  { title: 'Biryani House', sub: 'Since 1985 · Home delivery', bg: ['#f2c200', '#c28b00'], fg: '#3a1a00', accent: '#b3121b', shape: 'circle', urdu: 'بریانی' },
  { title: 'CRICKET LIVE', sub: 'Every match · Every ball', bg: ['#0f5c2e', '#062b15'], fg: '#fff', accent: '#f5f5f5', shape: 'circle' },
  { title: 'Desi Ghee', sub: 'Khalis. Taaza. Mazedaar.', bg: ['#f5e6c4', '#d8b877'], fg: '#5a3200', accent: '#b3121b', shape: 'bottle', urdu: 'دیسی گھی' },
  { title: 'MEHRAN AUTOS', sub: 'Easy installments available', bg: ['#e9e9e9', '#9aa3ab'], fg: '#1a1a1a', accent: '#c40d1e', shape: 'bars' },
  { title: 'Kinnow Juice', sub: 'Sargodha ka taaza ras', bg: ['#ff7a00', '#c24300'], fg: '#fff', accent: '#1c7a2b', shape: 'sun' },
  { title: 'FOOD STREET', sub: 'Gawalmandi nights · Open late', bg: ['#2b0a3d', '#0e0316'], fg: '#ffd166', accent: '#ef476f', shape: 'wave' },
  { title: 'Smart Homes', sub: 'DHA · Bahria · Gulberg', bg: ['#243b55', '#141e30'], fg: '#fff', accent: '#6dd5ed', shape: 'building' },
  { title: 'PAK INTERNET', sub: 'Fibre 1 Gbps · Rs 2999', bg: ['#6a0dad', '#2b0547'], fg: '#fff', accent: '#00e5ff', shape: 'phone' },
  { title: 'Clean Lahore', sub: 'Keep your city beautiful', bg: ['#1a8f4a', '#0b4524'], fg: '#fff', accent: '#dfffe9', shape: 'wave', urdu: 'صاف لاہور' },
];

function drawAd(ctx: CanvasRenderingContext2D, x: number, y: number, i: number, rng: RNG) {
  const ad = ADS[i % ADS.length];
  const W = 512, H = 256;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, W, H);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + W, y + H);
  g.addColorStop(0, ad.bg[0]);
  g.addColorStop(1, ad.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, W, H);
  ctx.fillStyle = ad.accent;
  ctx.globalAlpha = 0.9;
  switch (ad.shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(x + W * 0.8, y + H * 0.5, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ad.bg[1];
      ctx.beginPath();
      ctx.arc(x + W * 0.8, y + H * 0.5, 55, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bars':
      for (let k = 0; k < 5; k++) ctx.fillRect(x + W * 0.66 + k * 30, y + H - 30 - k * 30, 22, 30 + k * 30);
      break;
    case 'wave':
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(x, y + H * (0.7 + k * 0.1));
        for (let t = 0; t <= W; t += 16) ctx.lineTo(x + t, y + H * (0.7 + k * 0.1) + Math.sin(t / 40 + k) * 14);
        ctx.lineTo(x + W, y + H);
        ctx.lineTo(x, y + H);
        ctx.globalAlpha = 0.25 + k * 0.15;
        ctx.fill();
      }
      break;
    case 'phone':
      ctx.fillRect(x + W * 0.74, y + 40, 80, 170);
      ctx.fillStyle = ad.bg[1];
      ctx.fillRect(x + W * 0.74 + 8, y + 52, 64, 140);
      break;
    case 'bottle':
      ctx.fillRect(x + W * 0.78, y + 90, 50, 140);
      ctx.fillRect(x + W * 0.78 + 15, y + 40, 20, 55);
      break;
    case 'building':
      for (let k = 0; k < 4; k++) ctx.fillRect(x + W * 0.62 + k * 44, y + H - 60 - rng.int(40, 140), 36, 260);
      break;
    case 'sun':
      ctx.beginPath();
      ctx.arc(x + W * 0.8, y + H * 0.45, 55, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        ctx.fillRect(x + W * 0.8 + Math.cos(a) * 75 - 4, y + H * 0.45 + Math.sin(a) * 75 - 4, 8, 8);
      }
      break;
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = ad.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  let size = 58;
  ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  while (ctx.measureText(ad.title).width > W * 0.62 && size > 26) {
    size -= 2;
    ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  }
  ctx.fillText(ad.title, x + 24, y + 100);
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.fillText(ad.sub, x + 26, y + 140);
  if (ad.urdu) {
    ctx.fillStyle = ad.accent;
    ctx.font = 'bold 34px "Noto Nastaliq Urdu", "Geeza Pro", Tahoma, sans-serif';
    ctx.fillText(ad.urdu, x + 26, y + 200);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(x + 3, y + 3, W - 6, H - 6);
  ctx.restore();
}
