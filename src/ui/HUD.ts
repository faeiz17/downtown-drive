// In-game HUD: analog speedometer + tachometer, gear, indicator/headlight/handbrake tell-tales, clock, street name,
// minimap, FPS overlay and toast messages.
import type { WorldData } from '../data/types';
import { Minimap } from './Minimap';

export interface HudState {
  kmh: number;
  rpm: number;
  gear: string;
  indicatorLeft: boolean;
  indicatorRight: boolean;
  blink: boolean;
  headlights: boolean;
  handbrake: boolean;
  hour: number;
  street: string;
  units: 'kmh' | 'mph';
  x: number;
  z: number;
  heading: number;
  camera: string;
}

export class HUD {
  readonly root: HTMLDivElement;
  readonly minimap: Minimap;
  private speedo: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private gearEl: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private unitEl: HTMLDivElement;
  private clockEl: HTMLDivElement;
  private streetEl: HTMLDivElement;
  private tell: Record<string, HTMLDivElement> = {};
  private fpsEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastT = 0;
  private lastStreet = '';
  private streetT = 0;

  constructor(parent: HTMLElement, world: WorldData) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-street"></div>
      <div class="hud-map"><div class="hud-attrib">© OpenStreetMap contributors</div></div>
      <div class="hud-dash">
        <canvas class="hud-speedo"></canvas>
        <div class="hud-readout"><div class="hud-speed">0</div><div class="hud-unit">km/h</div><div class="hud-gear">D1</div></div>
        <div class="hud-tells">
          <div class="tell tell-left">◀</div><div class="tell tell-head">◉</div><div class="tell tell-hb">(P)</div><div class="tell tell-right">▶</div>
        </div>
      </div>
      <div class="hud-clock"></div>
      <div class="hud-fps"></div>
      <div class="hud-toast"></div>`;
    parent.appendChild(this.root);
    this.minimap = new Minimap(world, 220);
    this.root.querySelector('.hud-map')!.prepend(this.minimap.canvas);
    this.speedo = this.root.querySelector('.hud-speedo') as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.speedo.width = 250 * dpr;
    this.speedo.height = 250 * dpr;
    this.speedo.style.width = this.speedo.style.height = '250px';
    this.sctx = this.speedo.getContext('2d')!;
    this.sctx.scale(dpr, dpr);
    this.gearEl = this.root.querySelector('.hud-gear') as HTMLDivElement;
    this.speedEl = this.root.querySelector('.hud-speed') as HTMLDivElement;
    this.unitEl = this.root.querySelector('.hud-unit') as HTMLDivElement;
    this.clockEl = this.root.querySelector('.hud-clock') as HTMLDivElement;
    this.streetEl = this.root.querySelector('.hud-street') as HTMLDivElement;
    this.fpsEl = this.root.querySelector('.hud-fps') as HTMLDivElement;
    this.toastEl = this.root.querySelector('.hud-toast') as HTMLDivElement;
    for (const k of ['left', 'right', 'head', 'hb']) this.tell[k] = this.root.querySelector(`.tell-${k}`) as HTMLDivElement;
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  /** @returns whether the minimap is now visible */
  toggleMap(): boolean {
    const el = this.root.querySelector('.hud-map') as HTMLElement;
    const show = el.style.display === 'none';
    el.style.display = show ? '' : 'none';
    return show;
  }

  toast(msg: string, seconds = 2.2): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastT = seconds;
  }

  setFps(text: string | null): void {
    this.fpsEl.style.display = text ? '' : 'none';
    if (text) this.fpsEl.textContent = text;
  }

  update(dt: number, s: HudState, traffic: { x: number; z: number }[]): void {
    const speed = s.units === 'mph' ? s.kmh * 0.621371 : s.kmh;
    this.speedEl.textContent = String(Math.round(speed));
    this.unitEl.textContent = s.units === 'mph' ? 'mph' : 'km/h';
    this.gearEl.textContent = s.gear;
    this.gearEl.classList.toggle('rev', s.gear === 'R');
    this.tell.left.classList.toggle('on', s.indicatorLeft && s.blink);
    this.tell.right.classList.toggle('on', s.indicatorRight && s.blink);
    this.tell.head.classList.toggle('on', s.headlights);
    this.tell.hb.classList.toggle('on', s.handbrake);
    const h = Math.floor(s.hour), m = Math.floor((s.hour - h) * 60);
    this.clockEl.textContent = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    if (s.street !== this.lastStreet) {
      this.lastStreet = s.street;
      this.streetT = s.street ? 4 : 0;
      this.streetEl.textContent = s.street;
    }
    this.streetT -= dt;
    this.streetEl.classList.toggle('show', this.streetT > 0);
    this.toastT -= dt;
    if (this.toastT <= 0) this.toastEl.classList.remove('show');
    this.drawSpeedo(speed, s.rpm, s.units);
    this.minimap.draw(dt, s.x, s.z, s.heading, traffic, Math.min(1, s.kmh / 140) * 0.6);
  }

  private drawSpeedo(speed: number, rpm: number, units: string): void {
    const c = this.sctx, C = 125, R = 112;
    c.clearRect(0, 0, 250, 250);
    // dial background
    const g = c.createRadialGradient(C, C, 20, C, C, R);
    g.addColorStop(0, 'rgba(10,12,16,0.78)');
    g.addColorStop(1, 'rgba(10,12,16,0.45)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(C, C, R, 0, Math.PI * 2);
    c.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const maxV = units === 'mph' ? 140 : 220;
    // tacho arc (inner)
    const rpmFrac = Math.min(1, rpm / 7000);
    c.lineWidth = 7;
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.beginPath();
    c.arc(C, C, R - 38, a0, a1);
    c.stroke();
    c.strokeStyle = rpm > 6200 ? '#ff4d3a' : '#ffb400';
    c.beginPath();
    c.arc(C, C, R - 38, a0, a0 + (a1 - a0) * rpmFrac);
    c.stroke();
    c.strokeStyle = 'rgba(255,60,50,0.7)';
    c.beginPath();
    c.arc(C, C, R - 38, a0 + (a1 - a0) * (6500 / 7000), a1);
    c.stroke();
    // speed ticks
    c.strokeStyle = '#e8e8e8';
    c.fillStyle = '#e8e8e8';
    c.font = '600 12px "Segoe UI", Arial';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let v = 0; v <= maxV; v += 10) {
      const a = a0 + ((a1 - a0) * v) / maxV;
      const major = v % 20 === 0;
      c.lineWidth = major ? 2.5 : 1.2;
      c.beginPath();
      c.moveTo(C + Math.cos(a) * (R - 4), C + Math.sin(a) * (R - 4));
      c.lineTo(C + Math.cos(a) * (R - (major ? 16 : 10)), C + Math.sin(a) * (R - (major ? 16 : 10)));
      c.stroke();
      if (major && v % 40 === 0) c.fillText(String(v), C + Math.cos(a) * (R - 27), C + Math.sin(a) * (R - 27));
    }
    // needle
    const a = a0 + (a1 - a0) * Math.min(1, speed / maxV);
    c.strokeStyle = '#ff5533';
    c.lineWidth = 3.5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(C - Math.cos(a) * 12, C - Math.sin(a) * 12);
    c.lineTo(C + Math.cos(a) * (R - 12), C + Math.sin(a) * (R - 12));
    c.stroke();
    c.fillStyle = '#222';
    c.beginPath();
    c.arc(C, C, 8, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '600 10px "Segoe UI", Arial';
    c.fillText('×1000 rpm', C, C + 58);
  }
}
