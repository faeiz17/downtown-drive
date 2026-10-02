// In-game HUD in the style of an arcade street racer: a thin tachometer arc with the speed as big digits inside it,
// the gear in a box that turns red at the shift point, a nitrous arc underneath, tell-tales, drift score,
// street name, minimap, FPS overlay and toast messages.
import type { WorldData } from '../data/types';
import { Minimap } from './Minimap';

export interface HudState {
  kmh: number;
  rpm: number;
  redline: number;
  gear: string;
  /** nitrous tank 0..1 and whether it is burning */
  nitro: number;
  nitroActive: boolean;
  /** points of the drift in progress (0 when not drifting) */
  driftScore: number;
  /** last finished drift and a counter that changes each time one is banked */
  driftBanked: number;
  driftBankedCount: number;
  indicatorLeft: boolean;
  indicatorRight: boolean;
  blink: boolean;
  headlights: boolean;
  handbrake: boolean;
  /** e.g. "NIGHT · RAIN" */
  scene: string;
  street: string;
  units: 'kmh' | 'mph';
  x: number;
  z: number;
  heading: number;
  camera: string;
}

const SIZE = 300;
const MAX_RPM = 9000;
const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25; // tachometer sweep (270°), open at the bottom
const N0 = Math.PI * 0.69, N1 = Math.PI * 0.31; // nitrous arc sits in the gap at the bottom (drawn right-to-left)
const FONT = '"Avenir Next Condensed", "Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

export class HUD {
  readonly root: HTMLDivElement;
  readonly minimap: Minimap;
  private gauge: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private face: HTMLCanvasElement; // static dial face, drawn once
  private gearEl: HTMLDivElement;
  private boostEl: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private unitEl: HTMLDivElement;
  private sceneEl: HTMLDivElement;
  private streetEl: HTMLDivElement;
  private driftEl: HTMLDivElement;
  private driftNum: HTMLSpanElement;
  private tell: Record<string, HTMLDivElement> = {};
  private fpsEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastT = 0;
  private lastStreet = '';
  private streetT = 0;
  private lastBanked = 0;
  private bankT = 0;
  private rpmShown = 900;
  private lastSpeedText = '';
  private lastGear = '';
  private dpr: number;

  constructor(parent: HTMLElement, world: WorldData) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-boostfx"></div>
      <div class="hud-street"></div>
      <div class="hud-drift"><span class="hud-drift-label">DRIFT</span><span class="hud-drift-num">0</span></div>
      <div class="hud-map"><div class="hud-attrib">© OpenStreetMap contributors</div></div>
      <div class="hud-dash">
        <canvas class="hud-gauge"></canvas>
        <div class="hud-readout">
          <div class="hud-gear">1</div>
          <div class="hud-speed">0</div>
          <div class="hud-unit">KM/H</div>
        </div>
        <div class="hud-nos">NOS</div>
        <div class="hud-tells">
          <div class="tell tell-left">◀</div><div class="tell tell-head">◉</div><div class="tell tell-hb">(P)</div><div class="tell tell-right">▶</div>
        </div>
      </div>
      <div class="hud-scene"></div>
      <div class="hud-fps"></div>
      <div class="hud-toast"></div>`;
    parent.appendChild(this.root);
    this.minimap = new Minimap(world, 210);
    this.root.querySelector('.hud-map')!.prepend(this.minimap.canvas);
    this.gauge = this.root.querySelector('.hud-gauge') as HTMLCanvasElement;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.gauge.width = this.gauge.height = SIZE * this.dpr;
    this.gauge.style.width = this.gauge.style.height = `${SIZE}px`;
    this.g = this.gauge.getContext('2d')!;
    this.face = document.createElement('canvas');
    this.face.width = this.face.height = SIZE * this.dpr;
    this.drawFace();
    this.gearEl = this.root.querySelector('.hud-gear') as HTMLDivElement;
    this.boostEl = this.root.querySelector('.hud-boostfx') as HTMLDivElement;
    this.speedEl = this.root.querySelector('.hud-speed') as HTMLDivElement;
    this.unitEl = this.root.querySelector('.hud-unit') as HTMLDivElement;
    this.sceneEl = this.root.querySelector('.hud-scene') as HTMLDivElement;
    this.streetEl = this.root.querySelector('.hud-street') as HTMLDivElement;
    this.driftEl = this.root.querySelector('.hud-drift') as HTMLDivElement;
    this.driftNum = this.root.querySelector('.hud-drift-num') as HTMLSpanElement;
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
    const speedText = String(Math.round(speed));
    if (speedText !== this.lastSpeedText) {
      this.speedEl.textContent = speedText;
      this.lastSpeedText = speedText;
    }
    this.unitEl.textContent = s.units === 'mph' ? 'MPH' : 'KM/H';
    if (s.gear !== this.lastGear) {
      this.gearEl.textContent = s.gear;
      this.lastGear = s.gear;
    }
    this.boostEl.style.opacity = String(s.nitroActive ? 1 : 0);
    this.gearEl.classList.toggle('shift', s.rpm > s.redline - 250 && s.gear !== 'R');
    this.gearEl.classList.toggle('rev', s.gear === 'R');
    this.tell.left.classList.toggle('on', s.indicatorLeft && s.blink);
    this.tell.right.classList.toggle('on', s.indicatorRight && s.blink);
    this.tell.head.classList.toggle('on', s.headlights);
    this.tell.hb.classList.toggle('on', s.handbrake);
    if (this.sceneEl.textContent !== s.scene) this.sceneEl.textContent = s.scene;
    if (s.street !== this.lastStreet) {
      this.lastStreet = s.street;
      this.streetT = s.street ? 4 : 0;
      this.streetEl.textContent = s.street;
    }
    this.streetT -= dt;
    this.streetEl.classList.toggle('show', this.streetT > 0);
    this.toastT -= dt;
    if (this.toastT <= 0) this.toastEl.classList.remove('show');
    // drift score: live while sliding, then the banked total flashes
    if (s.driftBankedCount !== this.lastBanked) {
      this.lastBanked = s.driftBankedCount;
      this.bankT = 1.6;
      this.driftNum.textContent = `+${s.driftBanked.toLocaleString('en-US')}`;
    }
    this.bankT -= dt;
    const live = s.driftScore > 25;
    if (live && this.bankT <= 0) this.driftNum.textContent = Math.round(s.driftScore).toLocaleString('en-US');
    this.driftEl.classList.toggle('show', live || this.bankT > 0);
    this.driftEl.classList.toggle('banked', this.bankT > 0);
    this.drawGauge(dt, s);
    this.minimap.draw(dt, s.x, s.z, s.heading, traffic, Math.min(1, s.kmh / 200) * 0.6);
  }

  /** Static dial: backing disc, ticks, numerals, red zone, nitrous track. */
  private drawFace(): void {
    const c = this.face.getContext('2d')!;
    c.scale(this.dpr, this.dpr);
    const C = SIZE / 2, R = SIZE / 2 - 14;
    const bg = c.createRadialGradient(C, C, R * 0.2, C, C, R + 12);
    bg.addColorStop(0, 'rgba(6,9,14,0.5)');
    bg.addColorStop(0.75, 'rgba(6,9,14,0.3)');
    bg.addColorStop(1, 'rgba(6,9,14,0)');
    c.fillStyle = bg;
    c.beginPath();
    c.arc(C, C, R + 12, 0, Math.PI * 2);
    c.fill();
    // track
    c.lineCap = 'butt';
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.beginPath();
    c.arc(C, C, R, A0, A1);
    c.stroke();
    // red zone
    const ang = (rpm: number) => A0 + ((A1 - A0) * rpm) / MAX_RPM;
    c.lineWidth = 5;
    c.strokeStyle = '#ff2d2d';
    c.beginPath();
    c.arc(C, C, R - 1.5, ang(7600), A1);
    c.stroke();
    // ticks + numerals
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let rpm = 0; rpm <= MAX_RPM; rpm += 500) {
      const a = ang(rpm), major = rpm % 1000 === 0, red = rpm >= 7600;
      const r0 = R - (major ? 15 : 8);
      c.lineWidth = major ? 2.4 : 1.2;
      c.strokeStyle = red ? '#ff4b4b' : major ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
      c.beginPath();
      c.moveTo(C + Math.cos(a) * R, C + Math.sin(a) * R);
      c.lineTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
      c.stroke();
      if (major) {
        c.font = `italic 700 15px ${FONT}`;
        c.fillStyle = red ? '#ff5a5a' : 'rgba(255,255,255,0.92)';
        c.fillText(String(rpm / 1000), C + Math.cos(a) * (R - 28), C + Math.sin(a) * (R - 28));
      }
    }
    c.font = `600 9px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText('RPM ×1000', C, C - R + 46);
    // nitrous track
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.beginPath();
    c.arc(C, C, R - 3, N1, N0);
    c.stroke();
  }

  private drawGauge(dt: number, s: HudState): void {
    const c = this.g, C = SIZE / 2, R = SIZE / 2 - 14;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.gauge.width, this.gauge.height);
    c.drawImage(this.face, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // the needle is lightly damped so limiter bounce and shifts read as motion, not flicker
    this.rpmShown += (s.rpm - this.rpmShown) * Math.min(1, dt * 22);
    const rpm = Math.max(0, Math.min(MAX_RPM, this.rpmShown));
    const a = A0 + ((A1 - A0) * rpm) / MAX_RPM;
    const hot = rpm > s.redline - 250;
    // swept arc
    c.lineCap = 'butt';
    c.lineWidth = 9;
    const grad = c.createConicGradient ? c.createConicGradient(A0, C, C) : null;
    if (grad) {
      grad.addColorStop(0, 'rgba(255,255,255,0.25)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
      grad.addColorStop(0.75, hot ? 'rgba(255,70,60,0.95)' : 'rgba(255,255,255,0.95)');
      c.strokeStyle = grad;
    } else c.strokeStyle = hot ? 'rgba(255,70,60,0.9)' : 'rgba(255,255,255,0.8)';
    c.beginPath();
    c.arc(C, C, R - 22, A0, Math.max(A0 + 0.001, a));
    c.stroke();
    // needle
    c.lineCap = 'round';
    c.shadowColor = hot ? '#ff4030' : '#bfe4ff';
    c.shadowBlur = 12;
    c.strokeStyle = hot ? '#ff5a4a' : '#ffffff';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(C + Math.cos(a) * (R - 46), C + Math.sin(a) * (R - 46));
    c.lineTo(C + Math.cos(a) * (R + 4), C + Math.sin(a) * (R + 4));
    c.stroke();
    c.shadowBlur = 0;
    // nitrous: fills left → right along the bottom gap
    const n = Math.max(0, Math.min(1, s.nitro));
    if (n > 0.005) {
      c.lineWidth = 7;
      c.lineCap = 'round';
      c.strokeStyle = s.nitroActive ? '#9df3ff' : n < 0.15 ? '#3d7f95' : '#2fc8f2';
      c.shadowColor = '#35d6ff';
      c.shadowBlur = s.nitroActive ? 18 : 6;
      c.beginPath();
      c.arc(C, C, R - 3, N0, N0 + (N1 - N0) * n, true);
      c.stroke();
      c.shadowBlur = 0;
    }
  }
}
