import './ui/styles.css';
import type { WorldData } from './data/types';
import { initRapier } from './physics/PhysicsWorld';
import { loadSettings } from './core/Settings';
import { Game, nextFrame } from './core/Game';

declare global {
  interface Window {
    __game?: Game;
  }
}

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui')!;
  if (new URLSearchParams(location.search).get('view') === 'car') {
    const { runCarViewer } = await import('./ui/CarViewer');
    await runCarViewer(canvas);
    return;
  }
  ui.innerHTML = `<div class="loading"><div class="loading-title">GULBERG DRIVE</div><div class="bar"><div class="fill"></div></div><div class="msg">Loading…</div></div>`;
  const fill = ui.querySelector('.fill') as HTMLElement;
  const msg = ui.querySelector('.msg') as HTMLElement;
  const progress = (p: number, m: string) => {
    fill.style.width = `${Math.round(p * 100)}%`;
    msg.textContent = m;
  };
  progress(0.05, 'Loading map data (© OpenStreetMap contributors)…');
  const [R, data] = await Promise.all([
    initRapier(),
    fetch(`${import.meta.env.BASE_URL}world/gulberg.world.json`).then((r) => {
      if (!r.ok) throw new Error(`world data missing (${r.status}) – run "npm run build:world"`);
      return r.json() as Promise<WorldData>;
    }),
  ]);
  progress(0.4, 'Generating textures…');
  await nextFrame();
  const game = new Game(canvas, R, data, loadSettings());
  window.__game = game;
  const loading = ui.firstElementChild as HTMLElement;
  await game.init(progress, ui);
  loading.remove();
  game.start();
}

boot().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) ui.innerHTML = `<div class="loading"><div class="loading-title">Something went wrong</div><div class="msg">${String(err?.message ?? err)}</div></div>`;
});
