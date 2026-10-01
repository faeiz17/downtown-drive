import { writeFileSync, mkdirSync } from 'node:fs';
import { withGame } from '../shot';

mkdirSync('smoke-output', { recursive: true });

const { result, errors } = await withGame(async (open) => {
  const reports: string[] = [];
  for (const hour of ['15', '21.5']) {
    const page = await open(`capture&autoplay&hour=${hour}&quality=medium`, 1280, 720);
    await page.waitForTimeout(1500);
    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      g.mode = 'pause';
      g.car.headlightsOn = true;
      g.car.updateVisual(0.016, 1);
      const root = g.car.object;
      root.updateWorldMatrix(true, false);
      const pos = new (g.camera.position.constructor)();
      const fwd = new pos.constructor(0, 0, 1).applyQuaternion(root.quaternion);
      pos.copy(root.position).addScaledVector(fwd, 6.2);
      pos.y = root.position.y + 1.05;
      g.camera.position.copy(pos);
      g.camera.near = 0.15;
      g.camera.far = 4000;
      g.camera.updateProjectionMatrix();
      g.camera.lookAt(root.position.x, root.position.y + 0.55, root.position.z);
      g.camera.updateMatrixWorld(true);
      const r = g.renderer;
      r.aoPass.enabled = false;
      r.mbPass.enabled = false;
      const passes = r.composer.passes;
      for (const p of passes) p.renderToScreen = false;
      [...passes].reverse().find((p: { enabled: boolean; renderToScreen: boolean }) => p.enabled).renderToScreen = true;
      for (let i = 0; i < 3; i++) r.render(0.016, 0);
      const gl = r.renderer.getContext() as WebGL2RenderingContext;
      const pix = new Uint8Array(4);
      gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pix);
      const c = document.getElementById('game') as HTMLCanvasElement;
      const tmp = document.createElement('canvas');
      tmp.width = 32;
      tmp.height = 18;
      const ctx = tmp.getContext('2d')!;
      ctx.drawImage(c, 0, 0, 32, 18);
      const d = ctx.getImageData(0, 0, 32, 18).data;
      let max = 0, sum = 0, white = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        sum += l;
        if (l > max) max = l;
        if (l > 245) white++;
      }
      const info = g.renderer.renderer.info.render;
      return {
        url: c.toDataURL('image/png'),
        calls: info.calls,
        tris: info.triangles,
        avg: Math.round(sum / (d.length / 4)),
        max: Math.round(max),
        white,
        cam: g.camera.position.toArray().map((n: number) => +n.toFixed(2)),
        car: root.position.toArray().map((n: number) => +n.toFixed(2)),
        pix: Array.from(pix),
        buf: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      };
    });
    writeFileSync(`smoke-output/front-${hour}.png`, Buffer.from(result.url.split(',')[1], 'base64'));
    reports.push(`${hour} calls=${result.calls} avg=${result.avg} max=${result.max} pix=${result.pix} buf=${result.buf} cam=${result.cam}`);
    await page.close();
  }
  return reports;
});
console.log(result.join('\n'));
console.log(errors.filter((e) => !e.includes('deprecated') && !e.includes('PCF')).slice(0, 8).join('\n') || 'no errors');
