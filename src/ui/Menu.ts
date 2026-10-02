// Main menu, settings, controls and pause screens (DOM overlays).
import type { Settings } from '../core/Settings';
import { DEFAULT_SETTINGS } from '../core/Settings';

export interface MenuCallbacks {
  onPlay: () => void;
  onResume: () => void;
  onQuitToMenu: () => void;
  onSettingsChanged: (s: Settings) => void;
  onResetCar: () => void;
}

type Screen = 'main' | 'settings' | 'controls' | 'pause' | 'none';

export class Menu {
  readonly root: HTMLDivElement;
  private screen: Screen = 'none';
  private back: Screen = 'main';

  constructor(parent: HTMLElement, private settings: Settings, private cb: MenuCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'menu-root';
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return this.screen !== 'none';
  }

  show(screen: Screen): void {
    this.screen = screen;
    this.root.style.display = screen === 'none' ? 'none' : '';
    if (screen === 'main') this.renderMain();
    else if (screen === 'pause') this.renderPause();
    else if (screen === 'settings') this.renderSettings();
    else if (screen === 'controls') this.renderControls();
  }

  private renderMain(): void {
    this.back = 'main';
    this.root.innerHTML = `
      <div class="menu main">
        <div class="brand">
          <div class="brand-top">DOWNTOWN</div>
          <div class="brand-bottom">DRIVE</div>
          <div class="brand-sub">Los Angeles · Mitsubishi Lancer · DAK 539</div>
        </div>
        <div class="menu-buttons">
          <button data-a="play" class="primary">Play</button>
          <button data-a="settings">Settings</button>
          <button data-a="controls">Controls</button>
        </div>
        <div class="menu-foot">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL) · Car base mesh by 87-Motors (CC-BY 4.0) · Buildings partly procedural</div>
      </div>`;
    this.wire({ play: () => this.cb.onPlay(), settings: () => this.show('settings'), controls: () => this.show('controls') });
  }

  private renderPause(): void {
    this.back = 'pause';
    this.root.innerHTML = `
      <div class="menu pause">
        <h2>Paused</h2>
        <div class="menu-buttons">
          <button data-a="resume" class="primary">Resume</button>
          <button data-a="reset">Reset car</button>
          <button data-a="settings">Settings</button>
          <button data-a="controls">Controls</button>
          <button data-a="quit">Main menu</button>
        </div>
      </div>`;
    this.wire({
      resume: () => this.cb.onResume(),
      reset: () => {
        this.cb.onResetCar();
        this.cb.onResume();
      },
      settings: () => this.show('settings'),
      controls: () => this.show('controls'),
      quit: () => this.cb.onQuitToMenu(),
    });
  }

  private renderSettings(): void {
    const s = this.settings;
    this.root.innerHTML = `
      <div class="menu settings">
        <h2>Settings</h2>
        <div class="settings-grid">
          <label>Graphics quality</label>
          <div class="seg" data-k="quality">
            ${(['low', 'medium', 'high'] as const).map((q) => `<button data-v="${q}" class="${s.quality === q ? 'on' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}
          </div>
          <label>Time of day</label>
          <div class="seg" data-k="scene">
            ${(['dawn', 'day', 'afternoon', 'evening', 'night'] as const).map((q) => `<button data-v="${q}" class="${s.scene === q ? 'on' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}
          </div>
          <label>Rain</label>
          <div class="seg" data-k="rain"><button data-v="true" class="${s.rain ? 'on' : ''}">On</button><button data-v="false" class="${!s.rain ? 'on' : ''}">Off</button></div>
          <label>Smog / haze <span class="val" data-for="smog">${Math.round(s.smog * 100)}%</span></label>
          <input type="range" data-k="smog" min="0.2" max="2" step="0.05" value="${s.smog}">
          <label>Traffic density <span class="val" data-for="traffic">${Math.round(s.traffic * 100)}%</span></label>
          <input type="range" data-k="traffic" min="0" max="1.5" step="0.05" value="${s.traffic}">
          <label>Master volume <span class="val" data-for="masterVolume">${Math.round(s.masterVolume * 100)}%</span></label>
          <input type="range" data-k="masterVolume" min="0" max="1" step="0.05" value="${s.masterVolume}">
          <label>Engine volume <span class="val" data-for="engineVolume">${Math.round(s.engineVolume * 100)}%</span></label>
          <input type="range" data-k="engineVolume" min="0" max="1" step="0.05" value="${s.engineVolume}">
          <label>Effects volume <span class="val" data-for="sfxVolume">${Math.round(s.sfxVolume * 100)}%</span></label>
          <input type="range" data-k="sfxVolume" min="0" max="1" step="0.05" value="${s.sfxVolume}">
          <label>City ambience <span class="val" data-for="ambientVolume">${Math.round(s.ambientVolume * 100)}%</span></label>
          <input type="range" data-k="ambientVolume" min="0" max="1" step="0.05" value="${s.ambientVolume}">
          <label>Speed units</label>
          <div class="seg" data-k="units"><button data-v="kmh" class="${s.units === 'kmh' ? 'on' : ''}">km/h</button><button data-v="mph" class="${s.units === 'mph' ? 'on' : ''}">mph</button></div>
          <label>Driving assists (ABS, traction control, stability, counter-steer)</label>
          <div class="seg" data-k="assists"><button data-v="true" class="${s.assists ? 'on' : ''}">On</button><button data-v="false" class="${!s.assists ? 'on' : ''}">Off</button></div>
          <label>FPS counter</label>
          <div class="seg" data-k="showFps"><button data-v="true" class="${s.showFps ? 'on' : ''}">On</button><button data-v="false" class="${!s.showFps ? 'on' : ''}">Off</button></div>
          <label>Invert camera X</label>
          <div class="seg" data-k="invertCameraX"><button data-v="true" class="${s.invertCameraX ? 'on' : ''}">On</button><button data-v="false" class="${!s.invertCameraX ? 'on' : ''}">Off</button></div>
        </div>
        <div class="menu-buttons row">
          <button data-a="defaults">Defaults</button>
          <button data-a="back" class="primary">Back</button>
        </div>
      </div>`;
    this.root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k as keyof Settings;
        (s as unknown as Record<string, number>)[k] = parseFloat(inp.value);
        const lab = this.root.querySelector(`.val[data-for=${k}]`);
        if (lab) {
          const v = parseFloat(inp.value);
          lab.textContent = `${Math.round(v * 100)}%`;
        }
        this.cb.onSettingsChanged(s);
      });
    });
    this.root.querySelectorAll<HTMLDivElement>('.seg').forEach((seg) => {
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          const k = seg.dataset.k as keyof Settings;
          const raw = b.dataset.v!;
          (s as unknown as Record<string, unknown>)[k] = raw === 'true' ? true : raw === 'false' ? false : raw;
          seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          this.cb.onSettingsChanged(s);
        }),
      );
    });
    this.wire({
      back: () => this.show(this.back),
      defaults: () => {
        Object.assign(s, DEFAULT_SETTINGS);
        this.cb.onSettingsChanged(s);
        this.renderSettings();
      },
    });
  }

  private renderControls(): void {
    const rows: [string, string, string][] = [
      ['Accelerate', 'W / ↑', 'RT'],
      ['Brake / reverse', 'S / ↓', 'LT'],
      ['Steer', 'A D / ← →', 'Left stick'],
      ['Handbrake', 'Space', 'RB / A'],
      ['Horn', 'H', 'L3 / B'],
      ['Headlights', 'L', 'D-pad ↑'],
      ['Indicators left / right', 'Q / E', 'D-pad ← / →'],
      ['Hazard lights', 'Z', 'D-pad ↓'],
      ['Change camera', 'C', 'Back / View'],
      ['Look back', 'B', 'R3'],
      ['Orbit camera', 'Drag mouse', 'Right stick'],
      ['Nitrous', 'Shift', 'X / LB'],
      ['Reset car to road', 'R', 'Y'],
      ['Toggle minimap', 'M', '—'],
      ['Pause', 'Esc / P', 'Start'],
    ];
    this.root.innerHTML = `
      <div class="menu controls">
        <h2>Controls</h2>
        <table class="controls-table">
          <thead><tr><th>Action</th><th>Keyboard</th><th>Gamepad</th></tr></thead>
          <tbody>${rows.map(([a, k, g]) => `<tr><td>${a}</td><td><kbd>${k}</kbd></td><td><kbd>${g}</kbd></td></tr>`).join('')}</tbody>
        </table>
        <p class="hint">Pakistan drives on the left. The Lancer is right-hand drive. Gears are automatic: the dash shows D or R. Hold brake at a standstill to reverse, then accelerate to drive forward again.</p>
        <div class="menu-buttons row"><button data-a="back" class="primary">Back</button></div>
      </div>`;
    this.wire({ back: () => this.show(this.back) });
  }

  private wire(actions: Record<string, () => void>): void {
    this.root.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.a!]?.()));
  }
}
