// Wheel assembly: Dunlop tyre (lathe), satin-black 15" cross-spoke mesh rim (BBS RS-GT style), centre cap, lugs,
// brake disc and caliper. Built with the outer face towards +X, centred on the hub.
import * as THREE from 'three';
import { Part } from './part';
import { SPEC } from '../spec';

export interface WheelParts {
  tire: Part;
  lettering: Part;
  rim: Part;
  cap: Part;
  disc: Part;
  caliper: Part;
}

export function buildWheel(): WheelParts {
  const R = SPEC.tireRadius, W = SPEC.tireWidth, rr = SPEC.rimRadius;
  const hw = W / 2;
  const tire = new Part('Tire', 'Rubber');
  // lathe profile (x = radius, y = axial) then rotate so the axle is along X
  const prof: [number, number][] = [
    [rr - 0.005, -hw + 0.012], [rr + 0.015, -hw - 0.004], [R - 0.05, -hw - 0.006], [R - 0.02, -hw + 0.004], [R - 0.004, -hw + 0.018],
    [R, -hw + 0.03], [R, -0.05], [R - 0.006, -0.046], [R - 0.006, -0.036], [R, -0.032], [R, -0.008], [R - 0.006, -0.004], [R - 0.006, 0.004], [R, 0.008],
    [R, 0.032], [R - 0.006, 0.036], [R - 0.006, 0.046], [R, 0.05], [R, hw - 0.03], [R - 0.004, hw - 0.018], [R - 0.02, hw - 0.004], [R - 0.05, hw + 0.006],
    [rr + 0.015, hw + 0.004], [rr - 0.005, hw - 0.012],
  ];
  const lathe = new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r, a)), 56);
  // LatheGeometry revolves around Y; our axle is X → rotate
  lathe.rotateZ(-Math.PI / 2);
  lathe.computeVertexNormals();
  tire.addGeometry(lathe);

  // sidewall lettering ring (outer face, +X) – UV u = around, v = radial; texture applied at runtime
  const lettering = new Part('TireLettering', 'TireLettering');
  const seg = 72, r0 = R - 0.068, r1 = R - 0.028, x = hw + 0.0075;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const p = (a: number, r: number): [number, number, number] => [x, Math.sin(a) * r, Math.cos(a) * r];
    lettering.quad(p(a0, r0), p(a1, r0), p(a1, r1), p(a0, r1), [1, 0, 0], [[k / seg, 0], [(k + 1) / seg, 0], [(k + 1) / seg, 1], [k / seg, 1]]);
  }

  const rim = new Part('Rim', 'Rim');
  // barrel
  const barrel = new THREE.CylinderGeometry(rr - 0.004, rr - 0.004, W * 0.9, 48, 1, true);
  barrel.rotateZ(Math.PI / 2);
  rim.addGeometry(barrel);
  // outer lip
  const lip = new THREE.TorusGeometry(rr - 0.004, 0.009, 8, 56);
  lip.rotateY(Math.PI / 2);
  lip.translate(hw * 0.8, 0, 0);
  rim.addGeometry(lip);
  // hub disc
  const hub = new THREE.CylinderGeometry(0.068, 0.072, 0.03, 24);
  hub.rotateZ(Math.PI / 2);
  hub.translate(hw * 0.55, 0, 0);
  rim.addGeometry(hub);
  // 10 twin spokes splitting into a cross-mesh (RS-GT style)
  const face = hw * 0.78, hubX = hw * 0.55;
  const bar = (r0: number, a0: number, r1: number, a1: number, w: number, t: number) => {
    const p0 = new THREE.Vector3(hubX + (face - hubX) * ((r0 - 0.06) / (rr - 0.06)), Math.sin(a0) * r0, Math.cos(a0) * r0);
    const p1 = new THREE.Vector3(face, Math.sin(a1) * r1, Math.cos(a1) * r1);
    const len = p0.distanceTo(p1);
    const g = new THREE.BoxGeometry(t, w, len);
    const m = new THREE.Matrix4().lookAt(p1, p0, new THREE.Vector3(1, 0, 0));
    m.setPosition(p0.clone().add(p1).multiplyScalar(0.5));
    rim.addGeometry(g, m);
  };
  const n = 10;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const spread = (Math.PI / n) * 0.62;
    bar(0.064, a, 0.176, a - spread, 0.013, 0.016);
    bar(0.064, a, 0.176, a + spread, 0.013, 0.016);
    // cross links at mid radius make the mesh pattern
    bar(0.12, a + spread * 0.55, 0.176, a + (Math.PI / n), 0.009, 0.012);
  }
  // lug nuts (4 × 100 PCD)
  const cap = new Part('CenterCap', 'Chrome');
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const nut = new THREE.CylinderGeometry(0.0095, 0.0095, 0.018, 6);
    nut.rotateZ(Math.PI / 2);
    nut.translate(hubX + 0.022, Math.sin(a) * 0.05, Math.cos(a) * 0.05);
    cap.addGeometry(nut);
  }
  const cc = new THREE.CylinderGeometry(0.03, 0.032, 0.012, 20);
  cc.rotateZ(Math.PI / 2);
  cc.translate(hubX + 0.021, 0, 0);
  rim.addGeometry(cc);
  // triple-diamond on the cap
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.006, 0.0105);
    s.lineTo(0, 0.021);
    s.lineTo(-0.006, 0.0105);
    s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateZ(a - Math.PI / 2);
    g.rotateY(Math.PI / 2);
    g.translate(hubX + 0.0275, 0, 0);
    cap.addGeometry(g);
  }

  const disc = new Part('BrakeDisc', 'BrakeDisc');
  const dg = new THREE.CylinderGeometry(0.13, 0.13, 0.022, 36);
  dg.rotateZ(Math.PI / 2);
  dg.translate(-0.01, 0, 0);
  disc.addGeometry(dg);

  const caliper = new Part('Caliper', 'Caliper');
  const cg = new THREE.BoxGeometry(0.05, 0.07, 0.12);
  cg.translate(0.005, 0.1, -0.03);
  cg.rotateX(0.5);
  caliper.addGeometry(cg);
  return { tire, lettering, rim, cap, disc, caliper };
}
