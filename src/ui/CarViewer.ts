// Dev/inspection view of the car model: ?view=car&angle=front34|rear34|side|front|rear|top|interior&lights=1
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CarVisual, loadLancerGltf } from '../car/CarVisual';

export async function runCarViewer(canvas: HTMLCanvasElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: params.has('capture') });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb8bcc2);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, new THREE.HemisphereLight(0xdde6ff, 0x5a5248, 0.5));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.9 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const rawModel = params.get('model');
  let car: CarVisual;
  if (rawModel) {
    // raw inspection of an arbitrary GLB (e.g. models/src/sketchfab-lancer-2005.glb): orient Y-up, centre, sit on ground
    const g = await loadLancerGltf(`${import.meta.env.BASE_URL}${rawModel}`);
    const box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3());
    g.position.set(-c.x, -box.min.y, -c.z);
    if (params.get('flip') === '1') g.rotation.y = Math.PI;
    const holder = new THREE.Group();
    holder.add(g);
    scene.add(holder);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        const mm = m.material as THREE.MeshStandardMaterial;
        if (params.get('tint') && mm.name === 'body1') mm.color.set(params.get('tint')!);
        const hl = params.get('highlight');
        if (hl) {
          const nm = mm.name;
          m.material = new THREE.MeshStandardMaterial({ color: hl.split(',').includes(nm) ? 0xff00ff : 0x9aa0a8, roughness: 0.7, emissive: hl.split(',').includes(nm) ? 0x550055 : 0x000000 });
        }
      }
    });
    car = null as unknown as CarVisual;
  } else {
    car = new CarVisual(await loadLancerGltf(`${import.meta.env.BASE_URL}models/lancer.glb`));
    scene.add(car.root);
  }
  if (car && params.get('lights') === '1') {
    car.lights.head = true;
    car.lights.brake = true;
    car.lights.indicatorLeft = true;
    scene.background = new THREE.Color(0x101216);
    sun.intensity = 0.2;
    renderer.toneMappingExposure = 1.4;
  }
  if (car) {
    car.update(0.1);
    const steer = parseFloat(params.get('steer') ?? '0');
    for (let i = 0; i < 4; i++) car.setWheel(i, 0, i < 2 ? steer : 0, 0);
  }

  const camera = new THREE.PerspectiveCamera(parseFloat(params.get('fov') ?? '35'), innerWidth / innerHeight, 0.02, 100);
  const angles: Record<string, [number[], number[]]> = {
    front34: [[3.6, 1.45, 5.6], [0, 0.6, 0.2]],
    rear34: [[-3.6, 1.5, -5.6], [0, 0.65, -0.3]],
    side: [[7.8, 0.9, 0], [0, 0.72, 0]],
    front: [[0, 0.95, 7.5], [0, 0.65, 0]],
    rear: [[0, 1.0, -7.5], [0, 0.7, 0]],
    top: [[0, 9, 0.01], [0, 0, 0]],
    interior: [[-0.37, 1.13, -0.25], [-0.3, 0.95, 2]],
    wheel: [[1.9, 0.45, 1.3], [0.7, 0.3, 1.3]],
    frontlow: [[1.8, 0.7, 4.0], [0, 0.6, 1.4]],
  };
  angles.frontclose = [[1.6, 1.0, 3.9], [0.2, 0.62, 1.9]];
  angles.rearclose = [[-1.4, 1.15, -4.0], [-0.1, 0.8, -2.0]];
  angles.dash = [[0.0, 1.2, -0.6], [0.0, 0.9, 1.0]];
  const custom = params.get('cam');
  const [pos, look] = custom ? [custom.split(',').slice(0, 3).map(Number), custom.split(',').slice(3, 6).map(Number)] : angles[params.get('angle') ?? 'front34'] ?? angles.front34;
  camera.position.set(pos[0], pos[1], pos[2]);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(look[0], look[1], look[2]);
  controls.update();
  (window as any).__game = { mode: 'viewer', renderer: { render: () => renderer.render(scene, camera) }, stats: () => ({ mode: 'viewer', calls: renderer.info.render.calls, tris: renderer.info.render.triangles }) };
  const loop = () => {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
}
