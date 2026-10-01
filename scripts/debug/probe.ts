import { withGame } from '../shot';
const code = `(() => {
  const g = window.__game; const r = g.renderer.renderer; const gl = r.getContext();
  const attrs = gl.getContextAttributes();
  function read() { gl.bindFramebuffer(gl.FRAMEBUFFER, null); const out = []; for (const [x, y] of [[800, 450], [10, 10], [800, 880], [800, 20]]) { const p = new Uint8Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); out.push(Array.from(p)); } return out; }
  g.renderer.render(0.016, 0); const composed = read();
  r.setRenderTarget(null); r.render(g.scene, g.camera); const plain = read();
  return { attrs, composed, plain, err: gl.getError() };
})()`;
const { result, errors } = await withGame(async (open) => {
  const page = await open('capture&hour=15&y=60&pitch=-0.45');
  await page.waitForTimeout(1500);
  return page.evaluate(code);
});
console.log(JSON.stringify(result));
console.log(errors.filter((e) => !e.includes('deprecated') && !e.includes('PCFSoft')).slice(0, 8).join('\n'));
