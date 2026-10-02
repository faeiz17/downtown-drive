// Shop signboards (real OSM shop names where available) and roadside billboard adverts (invented brands).
import * as THREE from 'three';
import { drawAd, AD_W, AD_H } from './adArt';
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
    a.width = 4096;
    a.height = 2048;
    const actx = a.getContext('2d')!;
    for (let i = 0; i < 16; i++) drawAd(actx, (i % 4) * AD_W, Math.floor(i / 4) * AD_H, i);
    this.adTexture = new THREE.CanvasTexture(a);
    this.adTexture.colorSpace = THREE.SRGBColorSpace;
    this.adTexture.anisotropy = 8;
    this.adTexture.generateMipmaps = true;
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

