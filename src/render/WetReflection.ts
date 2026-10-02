// Planar reflections for wet roads. The scene is drawn a second time from a camera mirrored in the road plane into a
// half-resolution texture (only while it is wet); the asphalt shader samples it with a Fresnel term, ripple distortion
// and puddle variation. Streetlights, neon, windows, headlights and the car itself therefore mirror in the road.
import * as THREE from 'three';

export const wetUniforms = {
  tReflect: { value: null as THREE.Texture | null },
  uTexMat: { value: new THREE.Matrix4() },
  uWet: { value: 0 },
  uTime: { value: 0 },
};

const PLANE_Y = 0.03;

export class WetReflection {
  private rt: THREE.WebGLRenderTarget;
  private cam = new THREE.PerspectiveCamera();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLANE_Y);
  private n = new THREE.Vector3(0, 1, 0);
  private p = new THREE.Vector3(0, PLANE_Y, 0);
  private v = new THREE.Vector3();
  private t = new THREE.Vector3();
  private rot = new THREE.Matrix4();
  private size = new THREE.Vector2();
  hide: THREE.Object3D[] = [];

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.rt = new THREE.WebGLRenderTarget(512, 288, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
    wetUniforms.tReflect.value = this.rt.texture;
  }

  /** wet 0..1 (road wetness). Draws the mirrored view when there is anything to show. */
  render(wet: number, dt: number): void {
    wetUniforms.uWet.value = wet;
    wetUniforms.uTime.value += dt;
    if (wet < 0.03) return;
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const w = Math.max(256, Math.round(this.size.x * 0.5)), h = Math.max(144, Math.round(this.size.y * 0.5));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const cam = this.camera;
    cam.updateMatrixWorld();
    const cp = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    // mirror the camera in the road plane (same construction as three's Reflector)
    this.v.subVectors(this.p, cp).reflect(this.n).negate().add(this.p);
    this.rot.extractRotation(cam.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(this.rot).add(cp);
    this.t.subVectors(this.p, look).reflect(this.n).negate().add(this.p);
    const vc = this.cam;
    vc.position.copy(this.v);
    vc.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.n);
    vc.lookAt(this.t);
    vc.far = Math.min(cam.far, 700);
    vc.near = cam.near;
    vc.fov = cam.fov;
    vc.aspect = cam.aspect;
    vc.updateProjectionMatrix();
    vc.updateMatrixWorld();
    vc.matrixWorldInverse.copy(vc.matrixWorld).invert();
    wetUniforms.uTexMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    const prevTarget = r.getRenderTarget();
    const prevShadow = r.shadowMap.autoUpdate;
    const vis = this.hide.map((o) => o.visible);
    this.hide.forEach((o) => (o.visible = false));
    r.shadowMap.autoUpdate = false;
    r.clippingPlanes = [this.plane];
    wetUniforms.tReflect.value = null; // the road is clipped away in this pass, but must not sample the target it draws into
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, vc);
    r.clippingPlanes = [];
    wetUniforms.tReflect.value = this.rt.texture;
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = prevShadow;
    this.hide.forEach((o, i) => (o.visible = vis[i]));
  }
}
