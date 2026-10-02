// Rain: streaks animated entirely on the GPU in a box that follows the camera (no per-frame CPU work).
import * as THREE from 'three';

const N = 16000;
const BOX = new THREE.Vector3(46, 26, 46);

export class Rain {
  readonly mesh: THREE.LineSegments;
  private u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: BOX }, uAlpha: { value: 0 }, uVel: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(0.75, 0.8, 0.9) } };

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 6), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      pos.set([x, y, z, x, y, z], i * 6);
      seed.set([0, 1], i * 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('end', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, fog: false,
      vertexShader: /* glsl */ `
        attribute float end;
        uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uVel;
        varying float vA;
        void main() {
          vec3 p = position;
          float spd = 17.0 + fract(p.x * 91.7 + p.z * 53.1) * 8.0;
          float y = fract(p.y - uTime * spd / uBox.y);
          vec3 w = vec3(p.x, y, p.z) * uBox;
          w.xz += uCam.xz - uBox.xz * 0.5; w.y += max(uCam.y - 3.0, 0.0) - 2.0;
          // wrap around the camera so the box follows it without popping
          w.xz = uCam.xz + mod(w.xz - uCam.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5;
          // streak points back along the relative velocity (rain falls, car moves)
          vec3 rel = vec3(0.0, -spd, 0.0) - uVel;
          vec3 tail = -normalize(rel) * (0.35 + 0.012 * length(rel));
          w += tail * end;
          vA = (1.0 - end * 0.9) * (0.35 + 0.65 * fract(p.x * 17.3 + p.y * 7.7));
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `uniform float uAlpha; uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor, vA * uAlpha); }`,
    });
    this.mesh = new THREE.LineSegments(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(dt: number, amount: number, cam: THREE.Vector3, carVel: THREE.Vector3, light: number): void {
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    this.u.uTime.value += dt;
    this.u.uCam.value.copy(cam);
    this.u.uVel.value.copy(carVel);
    this.u.uAlpha.value = amount * (0.5 + 0.35 * light);
    this.u.uColor.value.setRGB(0.55 + 0.4 * light, 0.6 + 0.38 * light, 0.7 + 0.3 * light);
  }
}
