// Sequences and camera work for the trailer. Page-side; scripts/trailer.ts drives it frame by frame.
(() => {
  const T = window.__T2, g = T.g;
  const D2R = Math.PI / 180;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ease = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
  const lerp = (a, b, u) => a + (b - a) * u;
  T.seqs = {};
  T.cfg = T.cfg || { takes: [], olympic: null };
  T.lines = 0; // speed-line strength 0..1 (drawn onto the captured frame)

  T.cut = () => { g.renderer.taa.invalidate(); g.renderer.motionBlur.reset(); };

  // ---- road helpers
  T.road = (x, z, hd) => {
    const r = T.roadAt(x, z, 90);
    let h = Math.atan2(r.tx, r.tz);
    if (hd !== undefined) { const d = Math.atan2(Math.sin(hd - h), Math.cos(hd - h)); if (Math.abs(d) > Math.PI / 2) h += Math.PI; }
    const e = g.data.edges[r.edge];
    const off = e.oneway ? e.width / 2 - 1.8 : Math.min(e.width / 4, 2.2) + (e.median ?? 0) / 2;
    return { x: r.x - Math.cos(h) * off, z: r.z + Math.sin(h) * off, h, cx: r.x, cz: r.z, width: e.width };
  };
  const fwdV = () => { const h = T.heading(); return { x: Math.sin(h), z: Math.cos(h) }; };
  T.speedKmh = () => g.car.vehicle.groundKmh;

  // ---- camera plumbing
  let cur = null;
  const shotAt = (t) => { for (const s of cur.def.shots) if (t >= s.t0 && t < s.t1) return s; return cur.def.shots[cur.def.shots.length - 1]; };
  T.cam = () => {
    if (!cur) return;
    const t = cur.t, s = shotAt(t);
    if (cur.shot !== s) {
      cur.shot = s; cur.st = {};
      g.rig.mode = s.interior ? 'interior' : 'chase'; g.rig.snap();
      T.lines = 0;
      T.cut();
      if (s.enter) s.enter(cur.st);
    }
    const u = clamp01((t - s.t0) / (s.t1 - s.t0));
    s.cam(u, t, cur.st);
    if (s.lights) s.lights(u, t);
  };
  // fixed camera placed (car-relative) when the shot starts
  const fixedAt = (st, r, y, f) => { if (!st.p) st.p = T.L(r, y, f); return st.p; };

  // ---- sequence runner
  T.begin = (name, variant, portrait) => {
    const def = T.seqs[name];
    T.portrait = !!portrait;
    cur = { def, t: -def.pre, shot: null, st: {}, variant };
    T.stats = { crashes: 0, minUp: 1, maxRoll: 0, flipped: 0 };
    g.fx.force = 0; T.lines = 0; g.autoLateral = 0; g.autopilotKmh = 0; T.drive = null; g.car.vehicle.setGhost(false);
    g.cine = () => T.cam();
    T.cam = () => {};
    def.setup(variant);
    // pre-roll: let the scene run at real time before the first shot (not recorded)
    T.cam = () => {};
    T.drive = (d) => def.drive && def.drive(cur.t, d, cur);
    const n = Math.round(def.pre * 30);
    for (let i = 0; i < n; i++) { cur.t = -def.pre + i / 30; T.sim += 1 / 30; T.step(1 / 30); }
    T.cam = () => {
      if (!cur) return;
      const t = cur.t, s = shotAt(t);
      if (cur.shot !== s) { cur.shot = s; cur.st = {}; g.rig.mode = s.interior ? 'interior' : 'chase'; g.rig.snap(); T.lines = 0; T.cut(); if (s.enter) s.enter(cur.st); }
      const u = clamp01((t - s.t0) / (s.t1 - s.t0));
      s.cam(u, t, cur.st);
      if (s.lights) s.lights(u, t);
    };
    return { frames: Math.round(def.dur * 30), shots: def.shots.map((s) => ({ id: s.id, t0: s.t0, t1: s.t1 })) };
  };

  // 2D compositing of the captured frame: speed lines
  const out = document.createElement('canvas');
  const octx = out.getContext('2d', { alpha: false });
  let rs = 1;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  T.capture = (i, q = 0.93) => {
    const src = document.getElementById('game');
    if (out.width !== src.width || out.height !== src.height) { out.width = src.width; out.height = src.height; }
    octx.globalCompositeOperation = 'source-over';
    octx.drawImage(src, 0, 0);
    if (T.lines > 0.01) {
      const W = out.width, H = out.height, cx = W / 2, cy = H * 0.5, diag = Math.hypot(W, H) / 2;
      rs = (i + 1) * 7919;
      octx.globalCompositeOperation = 'lighter';
      octx.lineCap = 'round';
      const n = Math.round(170 * T.lines);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2, r0 = diag * (0.3 + rnd() * 0.35), r1 = r0 + diag * (0.12 + rnd() * 0.5) * T.lines;
        octx.strokeStyle = `rgba(190,225,255,${(0.1 + rnd() * 0.3) * T.lines})`;
        octx.lineWidth = (H / 540) * (0.8 + rnd() * 2.6);
        octx.beginPath(); octx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.8); octx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.8); octx.stroke();
      }
    }
    return out.toDataURL('image/jpeg', q);
  };

  T.render = (i, capture, quality) => {
    const def = cur.def, t = i / 30;
    cur.t = t;
    const ts = def.ts ? def.ts(t) : 1;
    T.sim += ts / 30;
    T.step(ts / 30);
    return capture ? T.capture(i, quality) : null;
  };
  T.end = () => {
    const s = T.stats, v = g.car.vehicle;
    const rep = { crashes: s.crashes, roll: Math.round(s.maxRoll), flipped: +s.flipped.toFixed(2), speed: Math.round(v.groundKmh), ok: s.crashes === 0 && s.maxRoll < 25 && s.flipped < 0.3 };
    g.fx.force = 0; g.autopilotKmh = 0; g.car.vehicle.setGhost(false); g.autoLateral = 0; T.lines = 0; T.drive = null;
    return rep;
  };

  // ================================================================== helpers for drift takes
  const takeDrive = (take) => (t, d) => {
    // t is the time since the take started (approach 1.0 s, then handbrake flick, then hold, then recover)
    d.throttle = t < 1.0 ? 0.8 : 1;
    if (t >= 1.0 && t < 1.3) { d.handbrake = true; d.steer = take.dir; }
    else if (t >= 1.3 && t < 4.2) d.steer = take.dir * take.hold;
    else if (t >= 4.2) d.steer = 0;
  };
  const placeTake = (take, lead) => {
    const hd0 = take.h0;
    const run = (take.kmh / 3.6) * 1.0;
    T.place(take.sx, take.sz, hd0, take.kmh, { radius: 260, traffic: 0, seed: 3 });
    g.car.vehicle.setGhost(true);
    void run; void lead;
  };
  // speed ramp: real time → 25 % at the apex → snap back
  const rampTs = (a, b, c, d, lo = 0.25) => (u) => (u < a ? 1 : u < b ? lerp(1, lo, ease((u - a) / (b - a))) : u < c ? lo : u < d ? lerp(lo, 1, ease((u - c) / (d - c))) : 1);

  const sceneNight = () => T.scene(22.1, 1);
  const bw = () => T.road(-100, 170, 2.48);

  // ================================================================== 1. cold open (0–4 s)
  T.seqs.open = {
    dur: 4.0, pre: 0.4,
    setup() {
      sceneNight();
      const r = T.road(206, -230, 2.48);
      T.place(r.x, r.z, r.h, 0, { traffic: 0 });
      g.car.headlightsOn = false;
      T.cfg.lightsOnAt = 0.45;
    },
    drive: (t, d) => { d.handbrake = true; if (t > 2.9) d.steer = Math.sin((t - 2.9) * 7) * 0.9; },
    shots: [
      { id: 'A1-headlight', t0: 0, t1: 1.0,
        cam(u, t, st) { const p = T.L(lerp(-0.9, -0.35, ease(u)), 0.55 + 0.05 * u, lerp(3.7, 3.0, ease(u))); T.look(p, T.L(0.58, 0.67, 2.3), 24, { shake: 0.004, fill: 70 }); },
        lights(u, t) { g.car.headlightsOn = t > 0.4 && !(t > 0.52 && t < 0.58) && !(t > 0.64 && t < 0.68); } },
      { id: 'A2-taillight', t0: 1.0, t1: 2.0,
        cam(u, t) { const p = T.L(lerp(-1.9, -1.2, ease(u)), 0.42, lerp(-3.6, -3.1, ease(u))); T.look(p, T.L(-0.6, 0.74, -2.2), 24, { shake: 0.004, fill: 60 }); },
        lights() { g.car.headlightsOn = true; const v = g.car.visual; v.lights.brake = true; v.lights.reverse = false; v.update(0); } },
      { id: 'A3-raindrop', t0: 2.0, t1: 3.0,
        enter(st) { const rl = g.renderer.rainLens; rl.spawnBig(0.32, 0.25, 26); rl.spawnBig(0.66, 0.1, 20); rl.spawnBig(0.5, 0.38, 14); },
        cam(u, t) { const p = T.L(-0.38, 1.15, -0.15); T.look(p, T.L(-0.36, 1.2, 4.0), 26, { shake: 0.003, noClip: true }); },
        lights() { g.car.headlightsOn = true; } },
      { id: 'A4-wheel', t0: 3.0, t1: 4.0,
        cam(u, t) { const p = T.L(lerp(0.0, 0.12, u), 1.08, lerp(-0.05, 0.1, u)); T.look(p, T.L(0.414, 0.8, 0.5), 38, { shake: 0.006, noClip: true }); },
        lights() { g.car.headlightsOn = true; } },
    ],
  };

  // ================================================================== 2. launch (4–6 s)
  T.seqs.launch = {
    dur: 2.0, pre: 0.0,
    setup() {
      sceneNight();
      const o = T.cfg.olympic;
      T.place(o.x, o.z, o.h, 0, { traffic: 0, seed: 2 });
      g.car.vehicle.assists = false;
      g.car.vehicle.setGhost(true);
    },
    drive(t, d) { d.throttle = 1; if (t < 0.72) { d.handbrake = true; g.fx.force = 1; } else { d.handbrake = false; g.fx.force = t < 1.6 ? 0.9 : 0; } },
    shots: [
      { id: 'B1-launch-front', t0: 0, t1: 1.333,
        enter(st) { st.p = T.L(1.1, 0.34, 8.5); },
        cam(u, t, st) { T.look(st.p, T.L(0, 0.5, 1.2), 40 + 6 * u, { shake: 0.012 + 0.02 * (t > 0.7 ? 1 : 0), noClip: true }); } },
      { id: 'B2-launch-rear', t0: 1.333, t1: 2.0,
        cam(u, t) { T.look(T.L(3.8, 0.55, -3.4 - 4 * u), T.L(0, 0.7, 2.0), 34, { shake: 0.012, noClip: true }); } },
    ],
  };
  const origEnd = T.end;
  T.end = () => { const r = origEnd(); g.car.vehicle.assists = true; return r; };

  // ================================================================== 3. speed montage (6–14 s)
  T.seqs.montage = {
    dur: 8.0, pre: 2.6,
    setup(variant) {
      sceneNight();
      const r = T.road(-100 + variant * 40, 170 - variant * 50, 2.48);
      T.place(r.x, r.z, r.h, 135, { traffic: 34, seed: 5 + variant });
      g.autopilotKmh = 150;
    },
    drive(t, d, c) {
      d.nitro = t > 2.0 && t < 6.5;
      // overtake the nearest car ahead during the near-miss shot
      if (t > 4.0 && t < 6.2) {
        const h = T.heading(), p = T.carPos(), fx = Math.sin(h), fz = Math.cos(h);
        let best = null;
        for (const v of g.traffic.vehicles) { const dx = v.x - p.x, dz = v.z - p.z, al = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx); if (al > 4 && al < 70 && lat < 3.2 && (!best || al < best.al)) best = { al, v }; }
        g.autoLateral = best ? 3.4 * ease((55 - best.al) / 25) : g.autoLateral * 0.9;
      } else g.autoLateral *= 0.92;
    },
    shots: [
      { id: 'M1-wheel-track', t0: 0, t1: 1.333, cam(u, t) { T.look(T.L(1.95, 0.36, 1.6), T.L(0.74, 0.32, 1.3), 30, { shake: 0.012, fill: 140 }); } },
      { id: 'M2-drone-follow', t0: 1.333, t1: 2.667, cam(u, t) { T.look(T.L(lerp(-2, 2, u), 22 + 4 * u, -7 + 3 * u), T.L(0, 0, 4), 46, { roll: 0.14 * (u - 0.5), noClip: true }); } },
      { id: 'M3-whip-pan', t0: 2.667, t1: 3.556, enter(st) { st.p = T.L(7.2, 1.0, 30); },
        cam(u, t, st) { T.look(st.p, T.L(0, 0.7, 2.5), 26 + 6 * u, { noClip: true }); } },
      { id: 'M4-bumper', t0: 3.556, t1: 4.889, cam(u, t) { T.look(T.L(0, 0.46, 2.55), T.L(0.2 * Math.sin(t * 3), 0.62, 30), 78, { shake: 0.02, noClip: true }); } },
      { id: 'M5-near-miss', t0: 4.889, t1: 5.778, cam(u, t) { T.look(T.L(-2.6, 0.55, -3.6), T.L(-0.2, 1.0, 14), 38, { shake: 0.01 }); } },
      { id: 'M6-light-streaks', t0: 5.778, t1: 7.111, streak: true, cam(u, t) { T.look(T.L(0, 0.62, -5.6), T.L(0, 1.0, 40), 66, { shake: 0.008 }); } },
      { id: 'M7-chase-close', t0: 7.111, t1: 8.0, cam(u, t) { T.look(T.L(lerp(3.2, 1.8, u), 0.95, lerp(-2.4, -1.0, u)), T.L(0, 0.7, 3.5), 44, { shake: 0.015 }); } },
    ],
  };

  // ================================================================== 4. drifts (14–24 s)
  const driftSeq = (id, takeIdx, hour, rain, shots, ts, dur) => ({
    dur, pre: 0.9,
    setup() {
      T.scene(hour, rain);
      const tk = T.cfg.takes[takeIdx];
      T.place(tk.sx, tk.sz, tk.h0, tk.kmh, { radius: 260, traffic: 0, seed: 3 });
      g.car.vehicle.setGhost(true);
      g.fx.force = 0;
      T.cfg.cur = tk;
    },
    drive(t, d) { const tk = T.cfg.cur; takeDrive(tk)(t + 0.9 + (T.cfg.driftLead || 0), d); g.fx.force = (t + 0.9 > 1.15 && t + 0.9 < 3.6) ? 0.8 : 0; },
    ts, shots,
  });
  const pathPt = (tk, tt) => { const k = Math.min(tk.path.length - 1, Math.max(0, Math.round(tt * 30))); const q = tk.path[k]; return { x: q[0], z: q[1], h: q[2] }; };
  const dRamp = rampTs(0.28, 0.4, 0.68, 0.76, 0.22);
  T.seqs.drift1 = driftSeq('d1', 0, 21.4, 1, [
    { id: 'D1-low-front-34', t0: 0, t1: 2.667,
      enter(st) { const tk = T.cfg.cur, q = pathPt(tk, 2.2), nx = Math.cos(q.h), nz = -Math.sin(q.h); st.p = { x: q.x - nx * 6.5 * tk.dir + Math.sin(q.h) * 3, y: 0.45, z: q.z - nz * 6.5 * tk.dir + Math.cos(q.h) * 3 }; },
      cam(u, t, st) { T.look(st.p, T.L(0, 0.55, 0.3), 40 + 8 * u, { shake: 0.006, noClip: true }); } },
  ], (t) => dRamp(t / 2.667), 2.667);
  T.seqs.drift2 = driftSeq('d2', 1, 7.05, 0, [
    { id: 'D2-overhead-dawn', t0: 0, t1: 2.667,
      cam(u, t) { T.look(T.L(2 * Math.sin(u * 2), 24 - 4 * u, -3 + 4 * u), T.L(0, 0, 0), 48, { roll: 0.35 * (u - 0.4), noClip: true }); } },
  ], (t) => dRamp(t / 2.667), 2.667);
  T.seqs.drift3 = driftSeq('d3', 2, 21.8, 1, [
    { id: 'D3-orbit', t0: 0, t1: 2.667,
      cam(u, t) { const a = lerp(-0.7, 2.4, u), r = 7.5; const c = T.carPos(); T.look({ x: c.x + Math.sin(a) * r, y: c.y + 1.3, z: c.z + Math.cos(a) * r }, T.L(0, 0.6, 0), 40, { shake: 0.004, noClip: true }); } },
  ], (t) => dRamp(t / 2.667), 2.667);
  T.seqs.drift4 = driftSeq('d4', 3, 22, 1, [
    { id: 'D4-smoke-close', t0: 0, t1: 1.0, cam(u, t) { T.look(T.L(-2.2, 0.5, -2.6), T.L(-0.8, 0.45, -1.3), 30, { shake: 0.01, noClip: true, fill: 90 }); } },
    { id: 'D5-skid-low', t0: 1.0, t1: 2.0, cam(u, t) { T.look(T.L(lerp(2.4, 3.2, u), 0.16, lerp(-4, -1.5, u)), T.L(0, 0.2, lerp(-1.5, 1.0, u)), 34, { shake: 0.006, noClip: true }); } },
  ], (t) => (t < 0.5 ? 0.9 : 0.55), 2.0);

  // ================================================================== 5. nitro (24–30 s)
  T.seqs.nitro = {
    dur: 6.0, pre: 2.0,
    setup(variant) {
      sceneNight();
      const r = T.road(-295 - variant * 30, -444 + variant * 50, -2.23);
      T.place(r.x, r.z, r.h, 105, { traffic: 12, seed: 8 + variant });
      g.autopilotKmh = 112;
    },
    drive(t, d) { d.nitro = t > 0.55 && t < 5.9; },
    shots: [
      { id: 'N1-cockpit-kick', t0: 0, t1: 2.0, interior: true,
        cam(u, t) { const k = ease((t - 0.55) / 0.12) * (1 - ease((t - 0.7) / 0.9)); g.camera.fov += 22 * k; g.camera.position.x += (Math.random() - 0.5) * 0.02 * (t > 0.55 ? 1 : 0.2); g.camera.position.y += (Math.random() - 0.5) * 0.02 * (t > 0.55 ? 1 : 0.2); g.camera.updateProjectionMatrix(); } },
      { id: 'N2-chase-punch', t0: 2.0, t1: 3.333, cam(u, t) { T.look(T.L(0, 1.25, lerp(-6.0, -7.4, u)), T.L(0, 0.9, 8), lerp(52, 82, ease(u)), { shake: 0.02 }); } },
      { id: 'N3-exhaust-flame', t0: 3.333, t1: 4.333, cam(u, t) { T.look(T.L(lerp(1.4, 0.9, u), 0.38, -3.0), T.L(0.5, 0.34, -2.35), 30, { shake: 0.012, noClip: true, fill: 50 }); } },
      { id: 'N4-speedlines', t0: 4.333, t1: 6.0, enter() { T.lines = 1; }, cam(u, t) { T.lines = 1; T.look(T.L(0, 0.95, -4.4), T.L(0, 1.0, 12), 92, { shake: 0.025 }); } },
    ],
  };

  // ================================================================== 6. weather contrast (30–36 s)
  T.seqs.timelapse = {
    dur: 3.0, pre: 0.0,
    setup() {
      T.scene(18.0, 0);
      const r = T.road(-60, 110, 2.48);
      T.place(r.x, r.z, r.h, 0, { traffic: 40, seed: 11 });
      g.car.vehicle.setGhost(true);
      T.cfg.base = r;
    },
    drive(t, d) { d.handbrake = true; const u = clamp01(t / 3); const hr = lerp(18.0, 21.6, ease(u)), rn = ease((u - 0.25) / 0.6); g.dayNight.hour = hr; T.grade(hr); g.rainTarget = rn; g.rain = rn; g.wet = rn * 0.9 + 0.1 * u; },
    ts: () => 3.0,
    shots: [
      { id: 'W1-dusk-to-night', t0: 0, t1: 3.0,
        cam(u, t) { const b = T.cfg.base; const hx = Math.sin(b.h), hz = Math.cos(b.h); const d = lerp(-50, 40, u); T.look({ x: b.x + hx * d, y: 38 - 6 * u, z: b.z + hz * d }, { x: b.x + hx * (d + 150), y: 14, z: b.z + hz * (d + 150) }, 38, { noClip: true }); } },
    ],
  };
  T.seqs.puddle = {
    dur: 3.0, pre: 0.0,
    setup(variant) {
      sceneNight();
      const r = T.road(-295, -444, -2.23);
      T.place(r.x, r.z, r.h, 112, { traffic: 0, seed: 12 });
      g.autopilotKmh = 112;
      T.cfg.cb = null;
    },
    ts: (t) => (t < 0.35 ? lerp(1, 0.27, ease(t / 0.35)) : 0.27),
    shots: [
      { id: 'W2-puddle-slowmo', t0: 0, t1: 3.0,
        enter(st) { st.p = T.L(3.2, 0.32, 19); },
        cam(u, t, st) { T.look(st.p, T.L(0, 0.45, 1.2), 30, { noClip: true }); } },
    ],
  };

  // ================================================================== 7. climax (36–42 s)
  T.seqs.cuts = {
    dur: 2.222, pre: 2.4,
    setup(variant) {
      sceneNight();
      const r = T.road(-800 + variant * 30, 38 - variant * 40, -0.67);
      T.place(r.x, r.z, r.h, 140, { traffic: 22, seed: 21 + variant });
      g.autopilotKmh = 155;
    },
    drive(t, d) { d.nitro = t > -0.4; },
    shots: [
      { id: 'C1-wheel', t0: 0, t1: 0.444, cam() { T.look(T.L(1.8, 0.33, 1.6), T.L(0.74, 0.32, 1.3), 28, { shake: 0.012, fill: 140 }); } },
      { id: 'C2-bumper', t0: 0.444, t1: 0.889, cam() { T.look(T.L(0.4, 0.45, 2.6), T.L(0, 0.7, 25), 82, { shake: 0.025, noClip: true }); } },
      { id: 'C3-overhead', t0: 0.889, t1: 1.333, cam() { T.look(T.L(0, 20, -2), T.L(0, 0, 5), 50, { noClip: true }); } },
      { id: 'C4-whip', t0: 1.333, t1: 1.778, enter(st) { st.p = T.L(-6.5, 0.9, 22); }, cam(u, t, st) { T.look(st.p, T.L(0, 0.7, 2.5), 26, { noClip: true }); } },
      { id: 'C5-rear-low', t0: 1.778, t1: 2.222, streak: true, cam() { T.look(T.L(0.3, 0.45, -4.4), T.L(0, 0.9, 20), 62, { shake: 0.02 }); } },
    ],
  };
  const finalRamp = (u) => (u < 0.32 ? 1 : u < 0.44 ? lerp(1, 0.2, ease((u - 0.32) / 0.12)) : u < 0.86 ? lerp(0.2, 0.12, (u - 0.44) / 0.42) : 0.1);
  T.seqs.final = {
    dur: 2.778, pre: 0.9,
    setup() { T.scene(22.2, 1); const tk = T.cfg.takes[4]; T.place(tk.sx, tk.sz, tk.h0, tk.kmh, { radius: 260, traffic: 0, seed: 3 }); g.car.vehicle.setGhost(true); T.cfg.cur = tk; },
    drive(t, d) { const tk = T.cfg.cur; takeDrive(tk)(t + 0.9, d); g.fx.force = (t + 0.9 > 1.15 && t + 0.9 < 3.6) ? 0.8 : 0; },
    ts: (t) => finalRamp(t / 2.778),
    shots: [
      { id: 'CL-final-drift', t0: 0, t1: 2.778,
        enter(st) { const tk = T.cfg.cur, q = pathPt(tk, 2.0), nx = Math.cos(q.h), nz = -Math.sin(q.h); st.p = { x: q.x + nx * 9 * tk.dir + Math.sin(q.h) * 3, y: 0.6, z: q.z + nz * 9 * tk.dir + Math.cos(q.h) * 3 }; },
        cam(u, t, st) { T.look(st.p, T.L(0, 0.55, 0), 30 + 14 * ease(u), { shake: 0.004, noClip: true }); } },
    ],
  };

  // ================================================================== 8. title plate
  T.seqs.plate = {
    dur: 3.222, pre: 0.5,
    setup() { sceneNight(); const r = T.road(206, -230, 2.48); T.place(r.x, r.z, r.h, 40, { traffic: 6, seed: 31 }); g.autopilotKmh = 75; },
    ts: () => 0.6,
    shots: [{ id: 'T-plate', t0: 0, t1: 3.222, enter(st) { st.p = T.L(-2.6, 0.55, -6.0); }, cam(u, t, st) { T.look(st.p, { ...T.L(0, 1.2, 24), y: 2.2 + 0.5 * u }, 32, { noClip: true }); } }],
  };
  T.names = Object.keys(T.seqs);
})();
