// Water on the "lens": drops that form, swell, run down and fly off at speed; in cockpit view the wipers sweep them away.
export class RainOverlay {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private drops: { x: number; y: number; r: number; vy: number; life: number; trail: number }[] = [];
  private acc = 0;
  private wiperT = 0;
  private wiperActive = false;
  private lastAngle = 0;
  private w = 0;
  private h = 0;
  /** dry the glass when nothing falls */
  constructor(parent: HTMLElement) {
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

  /** rain 0..1, speed in km/h, cockpit = view through the windscreen (wipers) */
  update(dt: number, rain: number, kmh: number, cockpit: boolean): void {
    const c = this.ctx, W = this.w, H = this.h;
    if (rain < 0.03 && this.drops.length === 0) {
      this.canvas.style.display = 'none';
      return;
    }
    this.canvas.style.display = '';
    c.clearRect(0, 0, W, H);
    const rate = (cockpit ? 26 : 5) * rain;
    this.acc += dt * rate;
    while (this.acc > 1) {
      this.acc--;
      this.drops.push({ x: Math.random() * W, y: Math.random() * H * 0.9, r: 1.5 + Math.random() * 3.5, vy: 0, life: 0, trail: 0 });
    }
    if (this.drops.length > 260) this.drops.splice(0, this.drops.length - 260);
    // wipers (cockpit only): a blade sweeps every ~1.5 s while it rains
    let wiperAng = -1, wiperPrev = -1;
    const px = W * 0.62, py = H * 1.04, len = H * 1.0;
    if (cockpit && rain > 0.15) {
      this.wiperT += dt;
      const period = 1.5 - 0.5 * rain;
      const t = (this.wiperT % period) / period;
      const sweep = t < 0.5 ? t * 2 : 2 - t * 2; // out and back
      wiperAng = Math.PI * 0.94 - sweep * Math.PI * 0.88;
      wiperPrev = this.lastAngle;
      this.lastAngle = wiperAng;
      this.wiperActive = true;
    } else this.wiperActive = false;
    const wind = Math.min(1, kmh / 160);
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life += dt;
      // big drops start to run; speed blows them up and sideways
      if (d.r > 3.3 || d.life > 4) d.vy += dt * (6 + 30 * rain);
      d.y += d.vy * dt - wind * dt * 60 * (cockpit ? 0.5 : 1) * (d.r > 2.5 ? 1 : 0.4);
      d.x += wind * dt * 24 * (Math.random() - 0.3);
      d.r = Math.min(5.5, d.r + dt * 0.05 * rain);
      if (d.y > H + 10 || d.y < -10 || d.x < -10 || d.x > W + 10) {
        this.drops.splice(i, 1);
        continue;
      }
      if (wiperAng >= 0) {
        const a = Math.atan2(py - d.y, d.x - px);
        const dist = Math.hypot(d.x - px, d.y - py);
        const lo = Math.min(wiperAng, wiperPrev) - 0.05, hi = Math.max(wiperAng, wiperPrev) + 0.05;
        if (dist < len && a > lo && a < hi) {
          this.drops.splice(i, 1);
          continue;
        }
      }
      if (d.vy > 4) {
        c.strokeStyle = 'rgba(200,220,255,0.10)';
        c.lineWidth = d.r * 0.6;
        c.beginPath();
        c.moveTo(d.x, d.y);
        c.lineTo(d.x, d.y - Math.min(40, d.vy * 0.35));
        c.stroke();
      }
      // refracting droplet: dark core with bright rim and a highlight
      const g = c.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.35, d.r * 0.1, d.x, d.y, d.r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.35, 'rgba(180,200,230,0.18)');
      g.addColorStop(0.85, 'rgba(10,15,25,0.28)');
      g.addColorStop(1, 'rgba(235,245,255,0.45)');
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(d.x, d.y, d.r, d.r * 1.15, 0, 0, Math.PI * 2);
      c.fill();
    }
    if (this.wiperActive) {
      c.save();
      c.strokeStyle = 'rgba(8,8,10,0.92)';
      c.lineCap = 'round';
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + Math.cos(wiperAng) * len, py - Math.sin(wiperAng) * len);
      c.stroke();
      c.lineWidth = 2.5;
      c.strokeStyle = 'rgba(40,40,44,0.9)';
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + Math.cos(wiperAng) * len * 0.35, py - Math.sin(wiperAng) * len * 0.35);
      c.stroke();
      c.restore();
    }
  }
}
