// Measure GPU ms of the current view with individual features toggled (static camera, Retina 2x).
import { withGame } from '../shot';
const quality = process.argv[2] ?? 'high';
const measure = `(async () => {
  const g = window.__game; const r = g.renderer;
  r.dynamicResolution = false; r.renderer.setPixelRatio(Math.min(devicePixelRatio, r.quality.pixelRatio)); r.pixelRatio = r.renderer.getPixelRatio(); r.resize();
  const sample = async (n = 50) => { const xs = []; for (let i = 0; i < n; i++) { await new Promise(res => requestAnimationFrame(res)); if (r.gpuMs) xs.push(r.gpuMs); } xs.sort((a,b)=>a-b); return +xs[Math.floor(xs.length/2)].toFixed(2); };
  g.mode = 'pause'; // freeze simulation; frames still render via manual loop below
  const out = {};
  const loop = async () => { r.render(0.016, 0); };
  // manual rendering while paused
  let stop = false; (function tick(){ if (stop) return; r.render(0.016, 0); requestAnimationFrame(tick); })();
  const passes = () => r.composer.passes;
  const fixScreen = () => { const ps = passes(); ps.forEach(p => p.renderToScreen = false); [...ps].reverse().find(p => p.enabled).renderToScreen = true; };
  out.base = await sample();
  const ao = r.aoPass.enabled; r.aoPass.enabled = false; fixScreen(); out.noAO = await sample(); r.aoPass.enabled = ao; fixScreen();
  const ta = r.taa.enabled; r.taa.enabled = false; fixScreen(); out.noTAA = await sample(); r.taa.enabled = ta; fixScreen();
  const mb = r.mbPass.enabled; r.mbPass.enabled = false; fixScreen(); out.noMotionBlur = await sample(); r.mbPass.enabled = mb; fixScreen();
  const sh = r.renderer.shadowMap.enabled; r.renderer.shadowMap.enabled = false; g.scene.traverse(o => { if (o.material) (Array.isArray(o.material)?o.material:[o.material]).forEach(m => m.needsUpdate = true); }); await sample(10); out.noShadows = await sample(); r.renderer.shadowMap.enabled = sh; g.scene.traverse(o => { if (o.material) (Array.isArray(o.material)?o.material:[o.material]).forEach(m => m.needsUpdate = true); }); await sample(10);
  const pls = []; g.scene.traverse(o => { if (o.isPointLight || o.isSpotLight) { pls.push([o, o.visible]); o.visible = false; } }); await sample(10); out.noPointSpotLights = await sample(); pls.forEach(([o,v]) => o.visible = v); await sample(10);
  const sky = g.dayNight.sky.visible; g.dayNight.sky.visible = false; out.noSky = await sample(); g.dayNight.sky.visible = sky;
  const pr = r.renderer.getPixelRatio(); r.renderer.setPixelRatio(1); r.resize(); await sample(5); out.pixelRatio1 = await sample(); r.renderer.setPixelRatio(pr); r.resize(); await sample(5);
  const passesState = passes().map(p => p.enabled); passes().forEach((p, i) => { if (i > 0) p.enabled = false; }); passes()[0].renderToScreen = true; await sample(5); out.sceneOnlyNoPost = await sample(); passes().forEach((p, i) => p.enabled = passesState[i]); fixScreen();
  out.pixelRatio = pr; out.calls = r.renderer.info.render.calls; out.tris = r.renderer.info.render.triangles;
  let lights = 0; g.scene.traverse(o => { if (o.isLight && o.visible) lights++; }); out.visibleLights = lights;
  stop = true;
  return out;
})()`;
const { result, errors } = await withGame(async (open) => {
  const page = await open(`capture&autoplay&hour=16&quality=${quality}`, 1512, 945, 2);
  await page.waitForTimeout(2500);
  return page.evaluate(measure);
});
console.log(quality, JSON.stringify(result, null, 1));
console.log(errors.filter((e) => !e.includes('deprecated')).slice(0, 5).join('\n') || 'no console errors');
