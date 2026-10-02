// Main game orchestrator: scene, renderer, world streaming, physics, car, traffic, cameras, HUD, audio, menus.
import * as THREE from 'three';
import type { WorldData } from '../data/types';
import { Renderer } from '../render/Renderer';
import { DayNight } from '../render/DayNight';
import { SunShadows } from '../render/SunShadows';
import { Rain } from '../render/Rain';
import { NightLights } from '../render/NightLights';
import { QUALITY, type QualityPreset } from '../render/Quality';
import { World } from '../world/World';
import { PhysicsWorld, type Rapier } from '../physics/PhysicsWorld';
import { Car } from '../car/Car';
import { loadLancerGltf } from '../car/CarVisual';
import { CameraRig } from '../camera/CameraRig';
import { TrafficManager } from '../traffic/TrafficManager';
import { AudioEngine } from '../audio/AudioEngine';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { Input } from './Input';
import { saveSettings, SCENE_HOURS, type Settings } from './Settings';
import { isMajor } from '../data/roadClasses';
import { leftNormal } from './geom2d';
import { Profiler } from './Profiler';
import { FramePacer } from './FramePacer';

export type GameMode = 'loading' | 'menu' | 'play' | 'pause' | 'debug';

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);
  readonly renderer: Renderer;
  readonly dayNight: DayNight;
  readonly shadows: SunShadows;
  readonly rainFx: Rain;
  readonly physics: PhysicsWorld;
  readonly world: World;
  readonly input: Input;
  readonly traffic: TrafficManager;
  readonly nightLights: NightLights;
  car!: Car;
  rig!: CameraRig;
  hud!: HUD;
  menu!: Menu;
  audio: AudioEngine | null = null;
  quality: QualityPreset;
  mode: GameMode = 'loading';
  private timer = new THREE.Timer();
  private accumulator = 0;
  private menuT = 0;
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  frameMs = 16;
  private fly = { yaw: 0, pitch: -0.2, speed: 40 };
  private params = new URLSearchParams(location.search);
  private surfaceTimer = 0;
  private streetTimer = 0;
  private street = '';
  private nearMajor = 0;
  private lastBlink = false;
  private autoLightsDone = false;
  private impactCd = 0;
  private stepsTotal = 0;
  /** telemetry for automated tests */
  readonly telemetry = { maxKmh: 0, distance: 0, impacts: 0, resets: 0 };
  readonly profiler = new Profiler();
  readonly pacer = new FramePacer();
  private pacerTimer = 0;
  private readonly scratchFwd = new THREE.Vector3();
  /** ?autopilot=<km/h>: follows the road network (benchmarks / attract mode) */
  autopilotKmh = parseFloat(new URLSearchParams(location.search).get('autopilot') ?? '0');
  private autopilotStuck = 0;
  /** shown top-right on the HUD, e.g. "NIGHT · RAIN" */
  sceneLabel = '';
  /** weather: 0..1 rain falling, 0..1 road wetness (follows the rain with a delay) */
  rain = 0;
  private rainTarget = 0;
  wet = 0;
  /** debug switch for scripts/test-smoothness.ts: false renders the raw latest physics state */
  interpolate = true;

  constructor(readonly canvas: HTMLCanvasElement, R: Rapier, readonly data: WorldData, public settings: Settings) {
    this.quality = QUALITY[settings.quality];
    this.renderer = new Renderer(canvas, this.scene, this.camera);
    this.physics = new PhysicsWorld(R);
    this.shadows = new SunShadows(this.scene, this.camera);
    this.dayNight = new DayNight(this.scene, this.renderer.renderer, this.shadows);
    this.rainFx = new Rain(this.scene);
    this.world = new World(data, this.physics);
    this.scene.add(this.world.scene);
    this.traffic = new TrafficManager(data, this.physics, this.scene);
    this.nightLights = new NightLights(this.scene, this.world.lampHeads, 0);
    this.input = new Input(canvas);
    window.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'play') this.pause();
    });
  }

  applySettings(): void {
    const s = this.settings;
    const qName = (this.params.get('quality') as keyof typeof QUALITY) ?? s.quality;
    this.quality = QUALITY[qName] ?? QUALITY.medium;
    const q = this.quality;
    this.renderer.applyQuality(q);
    this.shadows.configure({ enabled: q.shadows, mapSize: q.shadowMapSize, maxFar: q.shadowRange });
    this.dayNight.cycleMinutes = 0;
    if (!this.params.has('hour')) this.dayNight.hour = SCENE_HOURS[s.scene] ?? 18.45;
    this.rainTarget = this.params.has('rain') ? this.params.get('rain') !== '0' ? 1 : 0 : s.rain ? 1 : 0;
    this.sceneLabel = `${s.scene.toUpperCase()}${this.rainTarget ? ' · RAIN' : ''}`;
    this.dayNight.smog = s.smog;
    this.world.setQuality({ drawDistance: q.drawDistance, propNear: q.propNear, propFar: q.propFar, shadows: q.shadows, shadowRange: q.shadowRange });
    this.traffic.target = Math.round(q.traffic * s.traffic);
    this.nightLights.setCount(q.pointLights);
    this.camera.far = Math.max(2000, q.drawDistance * 3);
    this.camera.updateProjectionMatrix();
    if (this.car) {
      this.car.vehicle.assists = s.assists;
      this.car.visual.setHeadlightShadows(q.headlightShadows && q.shadows);
    }
    this.audio?.applyVolumes();
    this.hud?.setFps(s.showFps ? '…' : null);
  }

  async init(progress: (p: number, msg: string) => void, ui: HTMLElement): Promise<void> {
    const hourParam = this.params.get('hour');
    this.dayNight.hour = hourParam !== null ? parseFloat(hourParam) : SCENE_HOURS[this.settings.scene] ?? 18.45;
    const sp = this.data.spawn;
    const x = parseFloat(this.params.get('x') ?? String(sp.x));
    const z = parseFloat(this.params.get('z') ?? String(sp.z));
    const heading = parseFloat(this.params.get('heading') ?? String(sp.heading));
    progress(0.55, 'Loading your Lancer…');
    const skyReady = this.dayNight.load(import.meta.env.BASE_URL);
    const gltf = await loadLancerGltf(`${import.meta.env.BASE_URL}models/lancer.glb`);
    this.car = new Car(this.physics, gltf, x, z, heading);
    this.renderer.taa.setDynamicRoot(this.car.object);
    this.scene.add(this.car.object);
    this.rig = new CameraRig(this.camera, this.physics);
    this.hud = new HUD(ui, this.data);
    this.hud.visible = false;
    this.menu = new Menu(ui, this.settings, {
      onPlay: () => this.play(),
      onResume: () => this.resume(),
      onQuitToMenu: () => this.toMenu(),
      onSettingsChanged: (s) => {
        saveSettings(s);
        this.applySettings();
      },
      onResetCar: () => this.resetCar(),
    });
    this.applySettings();
    progress(0.7, 'Building Gulberg streets…');
    await nextFrame();
    this.world.prebuild(x, z, 700);
    this.traffic.prewarm(this.traffic.target + 10);
    // settle the car on its suspension
    for (let i = 0; i < 180; i++) {
      this.car.physicsStep(this.physics.dt, this.input.drive);
      this.physics.step();
    }
    progress(0.92, 'Warming up shaders…');
    await skyReady;
    this.rig.menuOrbit(0, this.car.vehicle.position);
    // every lit material has to know about the shadow cascades (see SunShadows)
    for (const m of this.world.litMaterials) this.shadows.patch(m);
    this.shadows.patchObject(this.scene);
    this.dayNight.update(0);
    this.shadows.update();
    this.world.setNight(this.dayNight.state.night);
    this.car.updateVisual(0, 1);
    this.renderer.renderer.compile(this.scene, this.camera);
    await nextFrame();
    if (this.params.get('debug') === 'fly') {
      this.mode = 'debug';
      this.camera.position.set(x, parseFloat(this.params.get('y') ?? '40'), z);
      this.fly.yaw = parseFloat(this.params.get('yaw') ?? String(heading + Math.PI));
      this.fly.pitch = parseFloat(this.params.get('pitch') ?? '-0.35');
    } else if (this.params.has('autoplay')) this.play();
    else this.toMenu();
  }

  // ------------------------------------------------------------------ modes
  toMenu(): void {
    this.mode = 'menu';
    this.hud.visible = false;
    this.menu.show('main');
    this.input.enabled = false;
  }

  play(): void {
    if (!this.audio) {
      try {
        this.audio = new AudioEngine(this.settings);
        this.audio.load(import.meta.env.BASE_URL).catch((e) => console.error('Audio samples failed to load:', e));
        this.traffic.onNearMiss = (closing) => {
          const s = Math.min(1, closing / 60);
          this.audio?.whoosh(s);
          this.car.vehicle.nitro = Math.min(1, this.car.vehicle.nitro + 0.06 + 0.06 * s);
          this.hud.toast('NEAR MISS', 0.9);
        };
        this.traffic.onHonk = (x, z, kind) => {
          const v = this.car.vehicle;
          const dx = x - v.position.x, dz = z - v.position.z;
          const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.camera.quaternion.clone());
          this.audio?.aiHonk(Math.hypot(dx, dz), (dx * -right.x + dz * -right.z) / Math.max(1, Math.hypot(dx, dz)), kind);
        };
      } catch (e) {
        console.warn('Audio unavailable:', e);
      }
    }
    void this.audio?.resume();
    this.mode = 'play';
    this.menu.show('none');
    this.hud.visible = true;
    this.input.enabled = true;
    this.input.clearActions();
    this.hud.toast('W/S drive · A/D steer · Space handbrake · C camera · H horn · L lights · R reset', 5);
  }

  pause(): void {
    if (this.mode !== 'play') return;
    this.mode = 'pause';
    this.menu.show('pause');
    this.input.enabled = false;
    this.audio?.suspend();
  }

  resume(): void {
    this.mode = 'play';
    this.menu.show('none');
    this.input.enabled = true;
    this.input.clearActions();
    void this.audio?.resume();
  }

  start(): void {
    this.timer.connect(document);
    // single render loop driven by the renderer (three-best-practices: setAnimationLoop); the pacer decides which
    // display refreshes run a frame so the cadence stays even on 120 Hz screens
    this.renderer.renderer.setAnimationLoop((t: number) => {
      if (this.pacer.shouldRender(t)) this.frame(t);
    });
  }

  // ------------------------------------------------------------------ gameplay helpers
  resetCar(): void {
    const v = this.car.vehicle;
    const r = this.world.nearestRoad(v.position.x, v.position.z, 300);
    this.telemetry.resets++;
    if (!r) {
      v.reset(this.data.spawn.x, this.data.spawn.z, this.data.spawn.heading);
      return;
    }
    const e = this.data.edges[r.edge];
    // align with the road in the direction closest to the car's heading, keep to the left lane
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.quaternion);
    let tx = r.tx, tz = r.tz;
    if (tx * fwd.x + tz * fwd.z < 0 && !e.oneway) {
      tx = -tx;
      tz = -tz;
    }
    const [lx, lz] = leftNormal(tx, tz);
    const off = e.oneway ? e.width / 2 - 1.8 : Math.min(e.width / 4, 2.2) + (e.median ?? 0) / 2;
    v.reset(r.x + lx * off, r.z + lz * off, Math.atan2(tx, tz));
    this.rig.snap();
    this.hud.toast('Car reset');
  }

  private updateSurface(): void {
    const v = this.car.vehicle;
    const grass = v.wheels.map((w) => {
      if (!w.contact) return false;
      if (w.point.y > 0.1) return false; // on a kerb/median/sidewalk top: hard surface
      const r = this.world.nearestRoad(w.point.x, w.point.z, 30);
      if (!r) return true;
      const e = this.data.edges[r.edge];
      return r.d > e.width / 2 + (e.sidewalk || 0.3) + 0.3;
    });
    v.setSurface(grass);
  }

  private updateStreet(): void {
    const v = this.car.vehicle;
    const r = this.world.nearestRoad(v.position.x, v.position.z, 40);
    const e = r ? this.data.edges[r.edge] : null;
    this.street = e && r!.d < e.width / 2 + 6 ? e.name ?? '' : '';
    this.nearMajor = e && isMajor(e.cls) && r!.d < 60 ? 1 - r!.d / 60 : 0;
  }

  private handleActions(): void {
    const i = this.input;
    if (i.take('pause')) {
      if (this.mode === 'play') this.pause();
      else if (this.mode === 'pause') this.resume();
      return;
    }
    if (this.mode !== 'play') return;
    if (i.take('camera')) this.hud.toast(`Camera: ${this.rig.cycle()}`, 1.2);
    if (i.take('lights')) {
      this.car.headlightsOn = !this.car.headlightsOn;
      this.autoLightsDone = true;
    }
    if (i.take('indLeft')) this.car.toggleIndicator('left');
    if (i.take('indRight')) this.car.toggleIndicator('right');
    if (i.take('hazard')) this.car.toggleIndicator('hazard');
    if (i.take('reset')) this.resetCar();
    if (i.take('map')) this.hud.toast(this.hud.toggleMap() ? 'Minimap on' : 'Minimap off', 1.2);
  }

  private updateFlyCamera(dt: number): void {
    const i = this.input;
    i.enabled = true;
    const [mx, my] = i.consumeMouse();
    this.fly.yaw -= mx * 0.003;
    this.fly.pitch = Math.max(-1.5, Math.min(1.2, this.fly.pitch - my * 0.003));
    const fwd = new THREE.Vector3(Math.sin(this.fly.yaw) * Math.cos(this.fly.pitch), Math.sin(this.fly.pitch), Math.cos(this.fly.yaw) * Math.cos(this.fly.pitch));
    const right = new THREE.Vector3(Math.cos(this.fly.yaw), 0, -Math.sin(this.fly.yaw));
    const sp = this.fly.speed * (i.isDown('ShiftLeft') ? 4 : 1) * dt;
    if (i.isDown('KeyW')) this.camera.position.addScaledVector(fwd, sp);
    if (i.isDown('KeyS')) this.camera.position.addScaledVector(fwd, -sp);
    if (i.isDown('KeyA')) this.camera.position.addScaledVector(right, sp);
    if (i.isDown('KeyD')) this.camera.position.addScaledVector(right, -sp);
    if (i.isDown('KeyE')) this.camera.position.y += sp;
    if (i.isDown('KeyQ')) this.camera.position.y -= sp;
    this.camera.lookAt(this.camera.position.clone().add(fwd));
  }

  // ------------------------------------------------------------------ frame
  private frame(t: number): void {
    const t0 = performance.now();
    const P = this.profiler;
    P.frameStart(t0);
    this.timer.update(t);
    const dt = Math.min(0.1, this.timer.getDelta());
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.input.update(dt);
    if (this.autopilotKmh > 0 && this.mode === 'play') this.autopilot();
    this.handleActions();
    const car = this.car, v = car.vehicle;
    P.begin('physics');
    const running = this.mode === 'play' || this.mode === 'menu' || this.mode === 'debug';

    // ---- fixed-step physics
    if (running) {
      this.accumulator += dt;
      let steps = 0;
      const drive = this.mode === 'play' ? this.input.drive : { throttle: 0, brake: 0, steer: 0, handbrake: true, horn: false, lookBack: false, nitro: false };
      while (this.accumulator >= this.physics.dt && steps < 10) {
        car.physicsStep(this.physics.dt, drive);
        this.physics.step();
        this.accumulator -= this.physics.dt;
        steps++;
        this.stepsTotal++;
      }
      if (steps === 10) this.accumulator = 0;
      // impacts (player chassis vs world/traffic)
      this.impactCd -= dt;
      let maxF = 0;
      let hitTraffic = false;
      for (const im of this.physics.impacts) {
        maxF = Math.max(maxF, im.force);
        if (this.traffic.impact(im.handle1, im.handle2)) hitTraffic = true;
      }
      void hitTraffic;
      this.physics.impacts.length = 0;
      if (maxF > 8000 && this.impactCd <= 0) {
        const s = Math.min(1, maxF / 90000);
        this.audio?.impact(s);
        this.rig.addShake(s * 0.8);
        this.impactCd = 0.25;
        this.telemetry.impacts++;
      }
    }
    P.end();
    // render the car between the last two physics states (alpha = how far into the next step this frame is)
    const alpha = this.interpolate ? this.accumulator / this.physics.dt : 1;
    P.begin('carVisual');
    car.updateVisual(dt, alpha);
    P.end();
    const carPos = car.object.position;
    P.begin('queries');

    // ---- periodic queries
    this.surfaceTimer -= dt;
    if (this.surfaceTimer <= 0) {
      this.surfaceTimer = 0.1;
      this.updateSurface();
    }
    this.streetTimer -= dt;
    if (this.streetTimer <= 0) {
      this.streetTimer = 0.5;
      this.updateStreet();
    }

    P.end();
    // ---- camera
    P.begin('camera');
    if (this.mode === 'debug') this.updateFlyCamera(dt);
    else if (this.mode === 'menu') {
      this.menuT += dt;
      this.rig.menuOrbit(this.menuT, carPos);
    } else if (this.mode === 'play') {
      const [mx, my] = this.input.consumeMouse();
      const sx = this.settings.invertCameraX ? -1 : 1;
      this.rig.orbit(mx * sx, my);
      this.rig.update(dt, { position: carPos, quaternion: car.object.quaternion, velocity: v.velocity, speed: v.speed, lateralG: v.lateralG, longG: v.longG, boost: v.boostFx, drift: v.drift }, this.input.drive.lookBack);
    }

    P.end();
    // ---- world, time of day, traffic
    if (this.mode !== 'pause') {
      P.begin('dayNight');
      this.rain += (this.rainTarget - this.rain) * Math.min(1, dt * 0.8);
      this.wet += (this.rainTarget - this.wet) * Math.min(1, dt * (this.rainTarget > this.wet ? 0.25 : 0.1));
      this.world.asphaltMat.roughness = 0.95 - 0.82 * this.wet;
      this.world.asphaltMat.envMapIntensity = 0.5 + 2.2 * this.wet;
      v.wet = this.wet;
      this.dayNight.smog = this.settings.smog * (1 + 0.8 * this.rain);
      this.rainFx.update(dt, this.rain, this.camera.position, v.velocity, 1 - this.dayNight.state.night);
      this.dayNight.update(dt);
      const night = this.dayNight.state.night;
      this.world.setNight(night);
      car.visual.night = night;
      if (!this.autoLightsDone && night > 0.55 && this.mode === 'play') {
        car.headlightsOn = true;
        this.autoLightsDone = true;
        this.hud.toast('Headlights on (L to toggle)');
      }
      this.nightLights.update(dt, carPos.x, carPos.z, night);
      P.end();
      P.begin('traffic');
      const camFwd = this.camera.getWorldDirection(this.scratchFwd);
      this.traffic.update(dt, { x: v.position.x, z: v.position.z, hx: Math.sin(v.heading), hz: Math.cos(v.heading), speed: v.speed, vx: v.velocity.x, vz: v.velocity.z }, this.camera.position.x, this.camera.position.z, camFwd.x, camFwd.z);
      this.traffic.sync(night);
      P.end();
    }
    this.world.update(this.camera.position.x, this.camera.position.z, carPos.x, carPos.z, dt, 6, P);

    // ---- HUD + audio
    if (this.mode === 'play') {
      P.begin('hud');
      this.telemetry.maxKmh = Math.max(this.telemetry.maxKmh, v.groundKmh);
      // on its roof or side for a moment: put it back on the road
      if (v.flipped > 1.4) this.resetCar();
      this.telemetry.distance += Math.abs(v.speed) * dt;
      const L = car.visual.lights;
      const blink = car.visual.blinkPhase;
      this.hud.update(dt, {
        kmh: v.groundKmh, rpm: v.drivetrain.rpm, redline: v.drivetrain.redline, gear: v.drivetrain.gearLabel, nitro: v.nitro, nitroActive: v.nitroActive,
        driftScore: v.driftScore, driftBanked: v.driftBanked, driftBankedCount: v.driftBankedCount,
        indicatorLeft: L.indicatorLeft, indicatorRight: L.indicatorRight, blink,
        headlights: car.headlightsOn, handbrake: v.handbrake, scene: this.sceneLabel, street: this.street, units: this.settings.units,
        x: carPos.x, z: carPos.z, heading: v.heading, camera: this.rig.mode,
      }, this.traffic.positions());
      P.end();
      P.begin('audio');
      const indicating = L.indicatorLeft || L.indicatorRight;
      const tick = indicating && blink !== this.lastBlink;
      this.lastBlink = blink;
      const dtn = v.drivetrain;
      let skid = 0;
      for (const w of v.wheels) skid = Math.max(skid, w.skid);
      this.audio?.update(dt, {
        rpm: dtn.rpm, redline: dtn.redline, throttle: dtn.throttleEff, load: dtn.torqueOut / 480, boost: dtn.boost, nitro: v.nitroActive, limiting: dtn.limiting, shiftCount: dtn.shiftCount,
        speed: v.groundKmh / 3.6, slip: v.maxSlip, skid,
        surfaceGrass: v.surfaceGrass, horn: this.input.drive.horn, indicatorTick: tick, reversing: v.reversing, interior: this.rig.mode === 'interior',
      }, { night: this.dayNight.state.night, nearMajorRoad: this.nearMajor, trafficNear: Math.min(1, this.traffic.count / 40), rain: this.rain, wet: this.wet });
      P.end();
      if (this.settings.showFps) {
        const s = this.stats();
        this.hud.setFps(`${s.fps} fps  ${s.frameMs} ms\n${s.drawCalls} calls  ${(s.triangles / 1000).toFixed(0)}k tris\ntraffic ${this.traffic.count}  colliders ${s.colliders}`);
      }
    }

    // ---- render
    this.shadows.update();
    this.renderer.exposure = this.dayNight.exposure;
    const blur = this.mode === 'play' && (this.rig.mode === 'chase' || this.rig.mode === 'far') ? Math.min(1, Math.max(0, (v.kmh - 50) / 120)) * 0.6 : 0;
    P.begin('render');
    this.renderer.render(dt, blur);
    P.end();
    this.frameMs = performance.now() - t0;
    if (this.renderer.gpuMs) P.add('gpu', this.renderer.gpuMs);
    P.frameEnd(this.frameMs);
    // cadence + GPU budget for dynamic resolution
    this.renderer.gpuBudgetMs = this.pacer.budgetMs * 0.8;
    this.pacerTimer += dt;
    if (this.pacerTimer > 3) {
      this.pacerTimer = 0;
      const r = P.report();
      this.pacer.evaluate(3.01, r.sections.gpu?.p95 ?? 0, r.frameCpu.p95);
    }
  }

  /** Simple road follower: steer towards the nearest road point 14 m ahead, hold a target speed. */
  private autopilot(): void {
    const v = this.car.vehicle;
    const h = v.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const look = 10 + Math.abs(v.speed) * 0.6;
    const r = this.world.nearestRoad(v.position.x + fx * look, v.position.z + fz * look, 60);
    const d = this.input.drive;
    if (!r) return;
    const e = this.data.edges[r.edge];
    let tx = r.tx, tz = r.tz;
    if (tx * fx + tz * fz < 0) {
      tx = -tx;
      tz = -tz;
    }
    const [lx, lz] = leftNormal(tx, tz);
    const off = e.oneway ? e.width / 2 - 1.7 : Math.min(e.width / 4, 2.2) + (e.median ?? 0) / 2;
    const gx = r.x + lx * off + tx * 4 - v.position.x, gz = r.z + lz * off + tz * 4 - v.position.z;
    let err = Math.atan2(gx, gz) - h;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    d.steer = Math.max(-1, Math.min(1, -err * 2.2));
    const target = this.autopilotKmh * (1 - Math.min(0.6, Math.abs(err)));
    d.throttle = v.kmh < target ? Math.min(1, (target - v.kmh) / 15 + 0.3) : 0;
    d.brake = v.kmh > target + 12 ? 0.5 : 0;
    d.handbrake = false;
    this.autopilotStuck = v.kmh < 3 ? this.autopilotStuck + 1 : 0;
    if (this.autopilotStuck > 180) {
      this.autopilotStuck = 0;
      this.resetCar();
    }
  }

  profile() {
    return this.profiler.report();
  }

  /** Debug/test hooks. */
  stats() {
    const info = this.renderer.renderer.info;
    const v = this.car?.vehicle;
    return {
      fps: Math.round(this.fps),
      frameMs: +this.frameMs.toFixed(2),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      chunks: this.world.stats.chunksVisible,
      colliders: this.world.stats.colliders,
      traffic: this.traffic.count,
      hour: +this.dayNight.hour.toFixed(2),
      mode: this.mode,
      kmh: v ? +v.kmh.toFixed(1) : 0,
      gear: v?.drivetrain.gearLabel,
      rpm: v ? Math.round(v.drivetrain.rpm) : 0,
      pos: v ? [+v.position.x.toFixed(1), +v.position.y.toFixed(2), +v.position.z.toFixed(1)] : null,
      street: this.street,
      camera: this.rig?.mode,
      ...this.telemetry,
    };
  }
}

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
