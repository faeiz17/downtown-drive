// Lightweight per-system frame profiler (the "profile first" rule): section timings + frame-interval jank stats.
// Zero allocations per frame: fixed-size ring buffers.

const N = 600; // ~10 s at 60 fps

class Ring {
  readonly buf = new Float32Array(N);
  i = 0;
  n = 0;
  push(v: number) {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % N;
    if (this.n < N) this.n++;
  }
  stats() {
    if (!this.n) return { avg: 0, p95: 0, max: 0 };
    const a = Array.from(this.buf.subarray(0, this.n)).sort((x, y) => x - y);
    let s = 0;
    for (const v of a) s += v;
    return { avg: +(s / a.length).toFixed(2), p95: +a[Math.floor(a.length * 0.95)].toFixed(2), max: +a[a.length - 1].toFixed(2) };
  }
}

export class Profiler {
  private sections = new Map<string, Ring>();
  private cur = new Map<string, number>();
  private t = 0;
  private name = '';
  readonly intervals = new Ring();
  readonly frameCpu = new Ring();
  jank = 0; // frames whose interval exceeded 1.5× the median display interval
  private lastT = 0;
  enabled = true;

  frameStart(now: number): void {
    if (this.lastT) {
      const iv = now - this.lastT;
      this.intervals.push(iv);
      if (iv > 25) this.jank++;
    }
    this.lastT = now;
    this.cur.clear();
  }

  begin(name: string): void {
    if (!this.enabled) return;
    this.name = name;
    this.t = performance.now();
  }

  end(): void {
    if (!this.enabled || !this.name) return;
    const dt = performance.now() - this.t;
    this.cur.set(this.name, (this.cur.get(this.name) ?? 0) + dt);
    this.name = '';
  }

  /** add an externally measured duration to a section for this frame */
  add(name: string, ms: number): void {
    this.cur.set(name, (this.cur.get(name) ?? 0) + ms);
  }

  frameEnd(cpuMs: number): void {
    this.frameCpu.push(cpuMs);
    for (const [k, v] of this.cur) {
      let r = this.sections.get(k);
      if (!r) this.sections.set(k, (r = new Ring()));
      r.push(v);
    }
    // sections not run this frame count as 0
    for (const [k, r] of this.sections) if (!this.cur.has(k)) r.push(0);
  }

  report() {
    const out: Record<string, { avg: number; p95: number; max: number }> = {};
    for (const [k, r] of this.sections) out[k] = r.stats();
    return { frameInterval: this.intervals.stats(), frameCpu: this.frameCpu.stats(), jank: this.jank, sections: out };
  }

  reset(): void {
    this.sections.clear();
    this.jank = 0;
    this.intervals.n = this.frameCpu.n = 0;
  }
}
