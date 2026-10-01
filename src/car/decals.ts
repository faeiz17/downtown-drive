// Runtime canvas textures: Punjab number plate, trunk badges, Dunlop sidewall lettering.
import * as THREE from 'three';
import { SPEC } from './spec';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** White Punjab plate: "PUNJAB" header, emblem left, ET&NC right, large black registration. */
export function plateTexture(text = SPEC.plate): THREE.CanvasTexture {
  const [c, g] = canvas(900, 400);
  g.fillStyle = '#f7f7f4';
  g.fillRect(0, 0, 900, 400);
  g.strokeStyle = '#111';
  g.lineWidth = 14;
  g.strokeRect(10, 10, 880, 380);
  // header band
  g.fillStyle = '#111';
  g.font = 'bold 64px "Arial", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('PUNJAB', 450, 70);
  // emblem (left) and ET&NC (right)
  g.fillStyle = '#1f6b3a';
  g.beginPath();
  g.arc(95, 70, 38, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f7f7f4';
  g.beginPath();
  g.arc(95, 70, 22, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1f6b3a';
  g.fillRect(89, 52, 12, 36);
  g.fillStyle = '#111';
  g.font = 'bold 40px Arial, sans-serif';
  g.fillText('ET&NC', 790, 72);
  g.fillRect(40, 118, 820, 5);
  // registration with slight emboss shadow
  g.font = '900 210px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillText(text, 454, 268);
  g.fillStyle = '#0d0d0d';
  g.fillText(text, 450, 262);
  return tex(c);
}

function chromeText(text: string, w: number, h: number, font: string, italic = true): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.clearRect(0, 0, w, h);
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  if (italic) g.transform(1, 0, -0.22, 1, h * 0.11, 0);
  const grad = g.createLinearGradient(0, h * 0.15, 0, h * 0.85);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.45, '#b9bec4');
  grad.addColorStop(0.55, '#6f757b');
  grad.addColorStop(1, '#e8ecef');
  g.lineWidth = Math.max(2, h * 0.05);
  g.strokeStyle = 'rgba(40,40,40,0.9)';
  g.strokeText(text, w / 2, h / 2);
  g.fillStyle = grad;
  g.fillText(text, w / 2, h / 2);
  g.restore();
  return tex(c);
}

export function badgeTextures(): Record<string, THREE.CanvasTexture> {
  const texas = (() => {
    const [c, g] = canvas(512, 160);
    const grad = g.createLinearGradient(0, 10, 0, 150);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#9aa0a6');
    grad.addColorStop(1, '#eceff1');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 86px "Times New Roman", serif';
    g.lineWidth = 5;
    g.strokeStyle = '#333';
    g.strokeText('TEXAS', 256, 58);
    g.fillStyle = grad;
    g.fillText('TEXAS', 256, 58);
    g.font = 'bold 40px Arial, sans-serif';
    g.strokeText('EDITION', 256, 126);
    g.fillText('EDITION', 256, 126);
    return tex(c);
  })();
  return {
    Badge_GLX: chromeText('GLX', 400, 130, '900 110px "Arial Black", Arial, sans-serif'),
    Badge_Texas: texas,
  };
}

/** Blue raised lettering "DUNLOP  SP TOURING" twice around the sidewall (u = angle, v = radial). */
export function tireLetteringTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(4096, 128);
  g.clearRect(0, 0, 4096, 128);
  g.fillStyle = '#2f7cff';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  const draw = (text: string, x: number, size: number) => {
    g.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
    g.save();
    g.translate(x, 64);
    g.fillStyle = '#1f55b8';
    g.fillText(text, 3, 3);
    g.fillStyle = '#3d8bff';
    g.fillText(text, 0, 0);
    g.restore();
  };
  for (const base of [0, 2048]) {
    draw('DUNLOP', base + 520, 92);
    draw('SP TOURING', base + 1500, 70);
  }
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
