// Page-side helpers for the trailer renderer (injected into the running game by scripts/trailer.ts).
(() => {
  const g = window.__game;
  const T = (window.__T2 = window.__T2 || {});
  const dtFrame = 1 / 30;
  T.g = g;
  T.t0 = performance.now() + 1000;
  T.sim = 0; // simulated seconds (all sequences)
  T.stats = { crashes: 0, minUp: 1, maxRoll: 0, flipped: 0 };

  T.init = (portrait) => {
    g.renderer.renderer.setAnimationLoop(null);
    g.renderer.dynamicResolution = false;
    // dynamic resolution may already have lowered the pixel ratio while the page was loading: pin it to 1.0 for filming
    g.renderer.pendingPixelRatio = 0;
    g.renderer.pixelRatio = 1;
    g.renderer.renderer.setPixelRatio(1);
    g.renderer.resize();
    g.hud.visible = false;
    g.settings.police = false;
    g.mode = 'play';
    g.input.enabled = true;
    g.autopilotKmh = 0;
    g.cine = () => { if (T.cam) T.cam(); };
    g.scriptDrive = (d) => { if (T.drive) T.drive(d); };
    T.portrait = !!portrait;
    document.documentElement.style.background = '#000';
  };

  // trailer grade: darker, moodier nights so the neon and the wet reflections carry the picture
  T.grade = (hour) => {
    const night = hour > 19.2 || hour < 5.8 ? 1 : hour > 18 ? (hour - 18) / 1.2 : hour < 7 ? (7 - hour) / 1.2 : 0;
    g.dayNight.tune.exposure = 0.95 - 0.28 * night;
    g.dayNight.tune.ambient = 1 - 0.3 * night;
  };
  T.scene = (hour, rain) => {
    T.grade(hour);
    g.dayNight.hour = hour;
    g.rainTarget = rain; g.rain = rain; g.wet = rain;
    g.car.headlightsOn = hour > 18.4 || hour < 6.2;
    g.dayNight.update(0);
  };

  const GEARS = [0, 67, 103, 141, 181, 226];
  T.place = (x, z, heading, kmh, opts = {}) => {
    const v = g.car.vehicle;
    v.reset(x, z, heading, 0.2);
    const s = kmh / 3.6;
    v.body.setLinvel({ x: Math.sin(heading) * s, y: 0, z: Math.cos(heading) * s }, true);
    for (const w of v.wheels) w.omega = s / v.radius;
    let gear = 1;
    for (let i = 1; i < GEARS.length; i++) if (kmh >= GEARS[i]) gear = i + 1;
    v.drivetrain.gear = gear;
    v.drivetrain.rpm = Math.max(1000, Math.min(7000, (kmh / (GEARS[gear] || 40)) * 4300));
    v.nitro = 1;
    v.drift = 0; v.driftScore = 0;
    g.car.hasPrev = false;
    g.world.prebuild(x, z, opts.radius ?? 420);
    g.traffic.target = opts.traffic ?? 0;
    g.traffic.reseed(opts.seed ?? 1);
    g.fx.force = 0;
    g.rig.snap();
    g.telemetry.impacts = 0;
    g.car.vehicle.flipped = 0;
    T.stats = { crashes: 0, minUp: 1, maxRoll: 0, flipped: 0 };
    for (let i = 0; i < 3; i++) T.step(0, false); // settle physics / lights without advancing time
  };

  /** advance the game by `dt` seconds of simulated time (0 = re-render only) */
  T.step = (dt, track = true) => {
    T.t0 += Math.max(dt, 0.0001) * 1000;
    g.frame(T.t0);
    if (track) {
      const v = g.car.vehicle, q = v.quaternion;
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      T.stats.minUp = Math.min(T.stats.minUp, upY);
      T.stats.maxRoll = Math.max(T.stats.maxRoll, Math.acos(Math.max(-1, Math.min(1, upY))) * 57.2958);
      T.stats.crashes = g.telemetry.impacts;
      T.stats.flipped = Math.max(T.stats.flipped, v.flipped);
    }
  };

  T.roadAt = (x, z, r = 60) => g.world.nearestRoad(x, z, r);

  // ---- car-relative coordinates: right, up, forward -> world
  T.L = (r, y, f) => {
    const c = g.car.object.position, h = g.car.vehicle.heading;
    // r > 0 = the car's RIGHT (the glTF car's +X is its left)
    return { x: c.x - r * Math.cos(h) + f * Math.sin(h), y: c.y + y, z: c.z + r * Math.sin(h) + f * Math.cos(h) };
  };
  T.carPos = () => g.car.object.position;
  T.heading = () => g.car.vehicle.heading;

  // ---- camera: place + look, with an optional hand-held shake; keeps the camera out of walls (ray from the target)
  T.look = (p, t, fov, opts = {}) => {
    const c = g.camera;
    let { x, y, z } = p;
    if (!opts.noClip) {
      // keep the camera out of walls: ray from the car (not the look target) to the camera
      const a = g.car.object.position, ay = a.y + 0.8;
      const dx = x - a.x, dy = y - ay, dz = z - a.z, d = Math.hypot(dx, dy, dz);
      if (d > 0.5) {
        const hit = g.physics.castRay(a.x, ay, a.z, dx / d, dy / d, dz / d, d, undefined);
        if (hit && hit.toi < d - 0.15) {
          const k = Math.max(0.5, hit.toi - 0.3);
          x = a.x + (dx / d) * k; y = ay + (dy / d) * k; z = a.z + (dz / d) * k;
        }
      }
    }
    const sh = opts.shake || 0, tt = T.sim;
    if (sh) {
      x += (Math.sin(tt * 31.7) * 0.6 + Math.sin(tt * 57.3 + 1.3) * 0.4) * sh;
      y += (Math.sin(tt * 37.9 + 0.7) * 0.6 + Math.sin(tt * 71.1 + 2.1) * 0.4) * sh;
      z += (Math.sin(tt * 29.3 + 2.9) * 0.6 + Math.sin(tt * 63.7 + 0.4) * 0.4) * sh;
    }
    c.position.set(x, Math.max(0.08, y), z);
    c.lookAt(t.x, t.y, t.z);
    if (opts.fill) { // key light for close-ups: the car's fill light moves to just beside the lens
      const L = g.carFill;
      L.intensity = opts.fill; L.distance = 14;
      L.position.set(x + (t.x - x) * 0.25, Math.max(0.2, y) + 0.35, z + (t.z - z) * 0.25);
    }
    if (opts.roll) c.rotateZ(opts.roll);
    // portrait: keep the same horizontal field of view feel by widening the vertical one
    let vf = fov;
    if (T.portrait) {
      // reframe for 9:16: keep ~55 % of the landscape horizontal field of view (the subject gets bigger in frame)
      const Hl = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 2.388);
      const Hp = Math.max(0.66, Math.min(1.46, Hl * (opts.pH || 0.56)));
      vf = Math.min(100, (2 * Math.atan(Math.tan(Hp / 2) / g.camera.aspect) * 180) / Math.PI);
    }
    c.fov = vf; c.near = 0.05; c.updateProjectionMatrix();
  };
  window.__T2 = T;
})();
