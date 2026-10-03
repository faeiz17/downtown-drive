// The wiper blade for cockpit views (the drops themselves are a refraction map, see render/RainLens.ts).
import type { RainLens } from '../render/RainLens';

export class RainOverlay {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  constructor(parent: HTMLElement, private lens: RainLens) {
    this.canvas.className = 'hud-drops';
    parent.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  private resize(): void {
    this.w = this.canvas.width = Math.round(window.innerWidth / 2);
    this.h = this.canvas.height = Math.round(window.innerHeight / 2);
  }
  update(): void {
    const a = this.lens.wiper.ang, c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    this.canvas.style.display = a >= 0 ? '' : 'none';
    if (a < 0) return;
    const px = this.w * 0.62, py = this.h * 1.04, len = this.h * 1.0;
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(8,8,10,0.94)';
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px + Math.cos(a) * len, py - Math.sin(a) * len);
    c.stroke();
    c.lineWidth = 2.5;
    c.strokeStyle = 'rgba(46,46,50,0.9)';
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px + Math.cos(a) * len * 0.35, py - Math.sin(a) * len * 0.35);
    c.stroke();
  }
}
