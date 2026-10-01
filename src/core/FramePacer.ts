// Frame pacing for high-refresh displays (e.g. MacBook ProMotion at 120 Hz).
// If a frame can't reliably finish inside one refresh interval, presenting "as fast as possible" alternates between
// 1 and 2 refresh intervals (8 ms / 16 ms), which reads as judder even at a high average fps. The pacer renders on
// every Nth display refresh so the cadence stays perfectly even, picking the smallest N the machine can sustain.

export class FramePacer {
  refreshMs = 16.67;
  divider = 1;
  private samples: number[] = [];
  private lastT = 0;
  private tick = 0;
  private evalTimer = 0;
  private calibrated = false;

  /** Returns true when this display refresh should run a game frame. */
  shouldRender(t: number): boolean {
    if (this.lastT && !this.calibrated) {
      this.samples.push(t - this.lastT);
      if (this.samples.length >= 40) {
        const s = this.samples.slice().sort((a, b) => a - b);
        this.refreshMs = s[Math.floor(s.length / 2)];
        this.calibrated = true;
        // start conservatively at ~60 fps on fast displays; evaluate() may promote to full rate
        this.divider = this.refreshMs < 12 ? Math.round(16.67 / this.refreshMs) : 1;
      }
    }
    this.lastT = t;
    this.tick++;
    return this.divider <= 1 || this.tick % this.divider === 0;
  }

  /** Frame time budget (ms) for the current cadence. */
  get budgetMs(): number {
    return this.refreshMs * this.divider;
  }

  /**
   * Re-evaluate the cadence from recent GPU / CPU cost (p90 values in ms). Hysteresis: promote to a faster cadence
   * only with plenty of headroom, demote as soon as the budget is exceeded.
   */
  evaluate(dt: number, gpuP90: number, cpuP90: number): void {
    if (!this.calibrated || this.refreshMs >= 12) return;
    this.evalTimer += dt;
    if (this.evalTimer < 3) return;
    this.evalTimer = 0;
    const cost = Math.max(gpuP90, cpuP90);
    const fastest = 1, slowest = Math.max(1, Math.round(33.4 / this.refreshMs));
    if (this.divider > fastest && cost < this.refreshMs * (this.divider - 1) * 0.6) this.divider--;
    else if (this.divider < slowest && cost > this.refreshMs * this.divider * 0.95) this.divider++;
  }
}
