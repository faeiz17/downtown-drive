// A small pool of real point lights that follows the nearest street lamps at night (the rest are faked with
// emissive lamp heads + additive light pools on the road).
// The number of VISIBLE lights must stay constant while driving: three.js bakes the light count into every shader,
// so toggling visibility recompiles programs (a guaranteed hitch). Lights are visible for the whole night and simply
// dim to zero when no lamp is nearby; they switch off together once at dawn.
import * as THREE from 'three';
import { SpatialGrid } from '../core/geom2d';

export class NightLights {
  private lights: THREE.PointLight[] = [];
  private found: boolean[] = [];
  private grid = new SpatialGrid<number>(60);
  private timer = 0;
  private cand: { i: number; d: number }[] = [];

  constructor(private scene: THREE.Scene, private heads: number[], count: number) {
    for (let i = 0; i < heads.length; i += 3) this.grid.insertPoint(i, heads[i], heads[i + 2]);
    this.setCount(count);
  }

  setCount(n: number): void {
    while (this.lights.length > n) this.scene.remove(this.lights.pop()!);
    while (this.lights.length < n) {
      const l = new THREE.PointLight(0xffc98a, 0, 26, 1.6);
      l.castShadow = false;
      l.visible = false;
      this.scene.add(l);
      this.lights.push(l);
    }
    this.found.length = n;
  }

  update(dt: number, x: number, z: number, night: number): void {
    if (!this.lights.length) return;
    const on = night > 0.05;
    this.timer -= dt;
    if (on && this.timer <= 0) {
      this.timer = 0.25;
      const idx = this.grid.queryRadius(x, z, 120);
      this.cand.length = 0;
      for (const i of idx) this.cand.push({ i, d: Math.hypot(this.heads[i] - x, this.heads[i + 2] - z) });
      this.cand.sort((a, b) => a.d - b.d);
      for (let k = 0; k < this.lights.length; k++) {
        const c = this.cand[k];
        this.found[k] = !!c;
        if (c) this.lights[k].position.set(this.heads[c.i], this.heads[c.i + 1] - 0.3, this.heads[c.i + 2]);
      }
    }
    const intensity = night * 55;
    for (let k = 0; k < this.lights.length; k++) {
      const l = this.lights[k];
      l.visible = on;
      l.intensity = on && this.found[k] ? intensity : 0;
    }
  }
}
