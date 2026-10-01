import { withGame, saveCanvas } from '../shot';
import { execSync } from 'node:child_process';
const mats = process.argv[2].split(';');
const angle = process.argv[3] ?? 'front34';
const out = process.argv[4] ?? 'grid';
const files: string[] = [];
await withGame(async (open) => {
  for (const m of mats) {
    const page = await open(`view=car&capture&angle=${angle}&model=models/src/sketchfab-lancer-2005.glb&highlight=${encodeURIComponent(m)}`, 700, 440);
    await page.waitForTimeout(400);
    const f = `smoke-output/mat-${m.replace(/,/g, '+')}-${angle}.png`;
    await page.evaluate(`(() => { const c = document.createElement('div'); c.textContent = ${JSON.stringify(m)}; })()`);
    await saveCanvas(page, f);
    files.push(f);
    await page.close();
  }
});
// label + tile
const cols = 4;
const labeled = files.map((f, i) => {
  const o = f.replace('.png', '-l.png');
  execSync(`ffmpeg -v error -y -i ${f} -vf "drawtext=text='${mats[i]}':x=10:y=10:fontsize=28:fontcolor=black:box=1:boxcolor=white@0.8" ${o}`);
  return o;
});
while (labeled.length % cols) labeled.push(labeled[labeled.length - 1]);
const rows = labeled.length / cols;
const inputs = labeled.map((f) => `-i ${f}`).join(' ');
let fc = '';
for (let r = 0; r < rows; r++) fc += labeled.slice(r * cols, r * cols + cols).map((_, k) => `[${r * cols + k}]`).join('') + `hstack=${cols}[r${r}];`;
fc += Array.from({ length: rows }, (_, r) => `[r${r}]`).join('') + (rows > 1 ? `vstack=${rows}` : 'null');
execSync(`ffmpeg -v error -y ${inputs} -filter_complex "${fc}" smoke-output/${out}.png`);
console.log('wrote smoke-output/' + out + '.png');
