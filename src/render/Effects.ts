// Driving effects: tyre smoke, skid marks, sparks, rain splashes, tyre spray, headlight light shafts and lamp flares.
// Everything is GPU-drawn from small pooled buffers (no per-frame allocation).
import * as THREE from 'three';
import type { Vehicle } from '../physics/Vehicle';

const SOFT = /* glsl */ `
float soft(vec2 p) { float d = length(p - 0.5) * 2.0; return smoothstep(1.0, 0.0, d); }`;

/** Pool of camera-facing soft particles (position, velocity, life, size, colour). */
class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size0: Float32Array;
  private size1: Float32Array;
  private alpha: Float32Array;
  private geo = new THREE.BufferGeometry();
  private head = 0;
  private aSize: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  private aPos: THREE.BufferAttribute;

  constructor(readonly n: number, scene: THREE.Scene, opts: { additive?: boolean; color: THREE.Color; gravity?: number; drag?: number; stretch?: boolean; scale?: number }) {
    this.pos = new Float32Array(n * 3).fill(0);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1000;
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(99);
    this.life = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.alpha = new Float32Array(n);
    const size = new Float32Array(n), a = new Float32Array(n);
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aSize = new THREE.BufferAttribute(size, 1);
    this.aAlpha = new THREE.BufferAttribute(a, 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('size', this.aSize);
    this.geo.setAttribute('alpha', this.aAlpha);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false, toneMapped: false,
      uniforms: { uColor: { value: opts.color }, uScale: { value: (opts.scale ?? 1) * 900 }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; varying float vA;
        uniform float uScale;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale / max(0.5, -mv.z);
          vA = alpha;
        }`,
      fragmentShader: /* glsl */ `${SOFT}
        uniform vec3 uColor; uniform float uLight; varying float vA;
        void main() { float s = soft(gl_PointCoord); if (s * vA < 0.003) discard; gl_FragColor = vec4(uColor * uLight, s * s * vA); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.gravity = opts.gravity ?? 0;
    this.drag = opts.drag ?? 1;
    this.mat = mat;
  }
  private gravity: number;
  private drag: number;
  readonly mat: THREE.ShaderMaterial;

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, alpha: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = s0;
    this.size1[i] = s1;
    this.alpha[i] = alpha;
  }

  update(dt: number): void {
    const size = this.aSize.array as Float32Array, al = this.aAlpha.array as Float32Array;
    const k = Math.pow(this.drag, dt * 60);
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) {
        al[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = Math.min(1, this.age[i] / this.life[i]);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.gravity * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t);
      al[i] = this.alpha[i] * (1 - t) * Math.min(1, t * 12);
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }
}

/** Ring-buffer ribbon of tyre marks on the road. */
class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private alpha: Float32Array;
  private head = 0;
  private last: { x: number; y: number; z: number; nx: number; nz: number; valid: boolean }[] = [];
  private aPos: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  constructor(private max: number, scene: THREE.Scene) {
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('alpha', this.aAlpha);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.pos.fill(0);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, fog: false, toneMapped: false,
      uniforms: { uTone: { value: 0.07 } },
      vertexShader: 'attribute float alpha; varying float vA; void main() { vA = alpha; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uTone; varying float vA; void main() { gl_FragColor = vec4(vec3(uTone), vA); }',
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    for (let i = 0; i < 4; i++) this.last.push({ x: 0, y: 0, z: 0, nx: 0, nz: 0, valid: false });
  }
  /** wheel index 0..3, ground point, heading of travel, intensity 0..1 (0 ends the mark). */
  add(w: number, x: number, y: number, z: number, hx: number, hz: number, k: number, half: number): void {
    const L = this.last[w];
    if (k <= 0.02) {
      L.valid = false;
      return;
    }
    const nx = -hz * half, nz = hx * half;
    if (L.valid) {
      const d = Math.hypot(x - L.x, z - L.z);
      if (d < 0.35) return;
      if (d > 4) L.valid = false;
      else {
        const i = this.head;
        this.head = (this.head + 1) % this.max;
        const yy = y + 0.02;
        this.pos.set([L.x - L.nx, yy, L.z - L.nz, L.x + L.nx, yy, L.z + L.nz, x - nx, yy, z - nz, x + nx, yy, z + nz], i * 12);
        const a = Math.min(0.85, k * 0.9);
        this.alpha.set([a * 0.85, a * 0.85, a, a], i * 4);
        this.aPos.needsUpdate = true;
        this.aAlpha.needsUpdate = true;
      }
    }
    L.x = x;
    L.y = y;
    L.z = z;
    L.nx = nx;
    L.nz = nz;
    L.valid = true;
  }
  set tone(v: number) {
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uTone.value = v;
  }
}

/** Soft additive flares on street lamps near the car (a few dozen sprites, rebuilt a few times a second). */
class LampFlares {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private aPos: THREE.BufferAttribute;
  private t = 99;
  constructor(private heads: number[], scene: THREE.Scene, private count = 56) {
    this.pos = new Float32Array(count * 3).fill(0);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -1000;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
      uniforms: { uAmt: { value: 0 }, uScale: { value: 900 } },
      vertexShader: /* glsl */ `uniform float uScale; varying float vD; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vD = -mv.z; gl_PointSize = clamp(1.6 * uScale / max(1.0, -mv.z), 6.0, 190.0); }`,
      fragmentShader: /* glsl */ `${SOFT} uniform float uAmt; varying float vD;
        void main() { vec2 p = gl_PointCoord - 0.5; float core = soft(gl_PointCoord); float streak = smoothstep(0.5, 0.0, abs(p.y) * 6.0) * smoothstep(0.5, 0.0, abs(p.x));
          float fade = smoothstep(220.0, 40.0, vD);
          gl_FragColor = vec4(vec3(1.0, 0.78, 0.5) * (core * core * 0.9 + streak * 0.5) * uAmt * fade, 1.0); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
  }
  update(dt: number, cam: THREE.Vector3, fwd: THREE.Vector3, amount: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uAmt.value = amount;
    this.points.visible = amount > 0.02;
    if (!this.points.visible) return;
    this.t += dt;
    if (this.t < 0.3) return;
    this.t = 0;
    // nearest heads in front of the camera
    const best: { d: number; i: number }[] = [];
    for (let i = 0; i < this.heads.length; i += 3) {
      const dx = this.heads[i] - cam.x, dz = this.heads[i + 2] - cam.z;
      const d = dx * dx + dz * dz;
      if (d > 230 * 230 || (dx * fwd.x + dz * fwd.z) < -20) continue;
      if (best.length < this.count) best.push({ d, i });
      else {
        let w = 0;
        for (let k = 1; k < best.length; k++) if (best[k].d > best[w].d) w = k;
        if (d < best[w].d) best[w] = { d, i };
      }
    }
    for (let k = 0; k < this.count; k++) {
      const b = best[k];
      if (!b) this.pos[k * 3 + 1] = -1000;
      else this.pos.set([this.heads[b.i], this.heads[b.i + 1], this.heads[b.i + 2]], k * 3);
    }
    this.aPos.needsUpdate = true;
  }
}

export class Effects {
  private smoke: ParticlePool;
  private spray: ParticlePool;
  private sparks: ParticlePool;
  private splash: ParticlePool;
  readonly skid: SkidMarks;
  private flares: LampFlares;
  private acc = [0, 0, 0, 0];
  private splashAcc = 0;
  private readonly fwd = new THREE.Vector3();
  /** set by Game each frame: 0..1 daylight, so smoke is lit white by day and dark grey at night */
  constructor(scene: THREE.Scene, lampHeads: number[]) {
    this.smoke = new ParticlePool(520, scene, { color: new THREE.Color(1, 1, 1), gravity: 0.35, drag: 0.965, scale: 1 });
    this.spray = new ParticlePool(520, scene, { color: new THREE.Color(0.85, 0.9, 1), gravity: -1.2, drag: 0.94, scale: 1 });
    this.sparks = new ParticlePool(260, scene, { additive: true, color: new THREE.Color(1, 0.62, 0.22), gravity: -9, drag: 0.985, scale: 0.55 });
    this.splash = new ParticlePool(420, scene, { additive: true, color: new THREE.Color(0.8, 0.88, 1), gravity: 0, drag: 1, scale: 1 });
    this.skid = new SkidMarks(3200, scene);
    this.flares = new LampFlares(lampHeads, scene);
  }

  /** Burst of sparks (wall scrape / crash). */
  sparkBurst(x: number, y: number, z: number, vx: number, vz: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 7;
      this.sparks.emit(x, y, z, vx * 0.4 + Math.cos(a) * s, 1.5 + Math.random() * 4, vz * 0.4 + Math.sin(a) * s, 0.35 + Math.random() * 0.5, 0.06 + Math.random() * 0.08, 0.02, 1);
    }
  }

  update(dt: number, v: Vehicle, cam: THREE.Vector3, rain: number, wet: number, night: number): void {
    const day = 1 - night;
    const hx = v.velocity.x, hz = v.velocity.z;
    const sp = Math.hypot(hx, hz);
    const dirx = sp > 0.5 ? hx / sp : Math.sin(v.heading), dirz = sp > 0.5 ? hz / sp : Math.cos(v.heading);
    this.smoke.mat.uniforms.uLight.value = 0.16 + 0.8 * day;
    this.spray.mat.uniforms.uLight.value = 0.25 + 0.7 * day;
    this.skid.tone = 0.05 + 0.1 * wet;
    // --- per wheel: skid marks, smoke, spray
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      const sliding = w.contact && !w.onGrass ? Math.min(1, Math.max(0, (w.skid - 3.2) / 9)) : 0;
      this.skid.add(i, w.point.x, w.contact ? w.point.y : 0, w.point.z, dirx, dirz, w.contact ? sliding : 0, 0.12);
      if (sliding > 0.05) {
        this.acc[i] += dt * (24 + 60 * sliding);
        while (this.acc[i] > 1) {
          this.acc[i]--;
          const j = () => (Math.random() - 0.5);
          this.smoke.emit(w.point.x + j() * 0.2, w.point.y + 0.1, w.point.z + j() * 0.2, hx * 0.25 + j() * 1.4, 0.8 + Math.random() * 1.2, hz * 0.25 + j() * 1.4, 1.6 + Math.random() * 1.4, 0.4, 1.9 + sliding * 1.2, 0.16 + 0.2 * sliding);
        }
      } else if (w.onGrass && w.contact && sp > 6) {
        this.acc[i] += dt * 25;
        while (this.acc[i] > 1) {
          this.acc[i]--;
          this.smoke.emit(w.point.x, w.point.y + 0.1, w.point.z, hx * 0.2 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), hz * 0.2 + (Math.random() - 0.5) * 2, 1.2, 0.4, 2, 0.3);
        }
      }
      // rain: spray thrown up behind each tyre
      if (wet > 0.3 && w.contact && sp > 12) {
        const rate = (sp - 10) * 1.3 * wet;
        this.acc[i] += dt * rate * 0.5;
        while (this.acc[i] > 1) {
          this.acc[i]--;
          const j = () => (Math.random() - 0.5);
          this.spray.emit(w.point.x + j() * 0.25, w.point.y + 0.08, w.point.z + j() * 0.25, -dirx * sp * 0.12 + j() * 2.2, 1.2 + Math.random() * 2.2, -dirz * sp * 0.12 + j() * 2.2, 0.6 + Math.random() * 0.5, 0.35, 1.5 + sp * 0.02, 0.2 * wet);
        }
      }
    }
    // --- rain splashes on the road around the camera
    if (rain > 0.05) {
      this.splashAcc += dt * 340 * rain;
      while (this.splashAcc > 1) {
        this.splashAcc--;
        const a = Math.random() * Math.PI * 2, r = 3 + Math.sqrt(Math.random()) * 38;
        this.splash.emit(cam.x + Math.cos(a) * r, 0.06, cam.z + Math.sin(a) * r, 0, 0, 0, 0.22, 0.05, 0.3, 0.55);
      }
    }
    this.smoke.update(dt);
    this.spray.update(dt);
    this.sparks.update(dt);
    this.splash.update(dt);
    // lamp flares: strongest at night and in rain / haze
    this.fwd.set(Math.sin(v.heading), 0, Math.cos(v.heading));
    this.flares.update(dt, cam, this.fwd, Math.min(1, night * 1.1) * (0.7 + 0.5 * rain));
  }
}
