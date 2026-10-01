// Keyboard + gamepad input mapped to driving controls. Analog values are smoothed for keyboard.
export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (also reverse when stopped)
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
  horn: boolean;
  lookBack: boolean;
}

type Action = 'horn' | 'lights' | 'camera' | 'reset' | 'indLeft' | 'indRight' | 'hazard' | 'pause' | 'map';

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private padPrev: boolean[] = [];
  readonly drive: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, lookBack: false };
  private kbSteer = 0;
  /** mouse orbit for the chase camera */
  mouseDX = 0;
  mouseDY = 0;
  private dragging = false;
  enabled = true;
  usingGamepad = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this.isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      const a = this.actionFor(e.code);
      if (a) this.pressed.add(a);
      if (this.isGameKey(e.code)) e.preventDefault();
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    target.addEventListener('mousedown', () => (this.dragging = true));
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  private isGameKey(code: string): boolean {
    return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code);
  }

  private actionFor(code: string): Action | null {
    switch (code) {
      case 'KeyH': return 'horn';
      case 'KeyL': return 'lights';
      case 'KeyC': return 'camera';
      case 'KeyR': return 'reset';
      case 'KeyQ': return 'indLeft';
      case 'KeyE': return 'indRight';
      case 'KeyZ': return 'hazard';
      case 'Escape': case 'KeyP': return 'pause';
      case 'KeyM': return 'map';
      default: return null;
    }
  }

  /** Consume a one-shot action press. */
  take(a: Action): boolean {
    const had = this.pressed.has(a);
    this.pressed.delete(a);
    return had;
  }

  clearActions(): void {
    this.pressed.clear();
  }

  private k(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  update(dt: number): void {
    const d = this.drive;
    if (!this.enabled) {
      d.throttle = d.brake = d.steer = 0;
      d.handbrake = d.horn = d.lookBack = false;
      return;
    }
    // keyboard
    const up = this.k('KeyW', 'ArrowUp'), down = this.k('KeyS', 'ArrowDown');
    const left = this.k('KeyA', 'ArrowLeft'), right = this.k('KeyD', 'ArrowRight');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    // keyboard steering ramp: quick but not binary (full lock in ~0.18 s, faster centring and direction changes)
    const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.kbSteer) ? 10 : 5.5;
    const diff = target - this.kbSteer;
    this.kbSteer += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
    let throttle = up ? 1 : 0, brake = down ? 1 : 0, steer = this.kbSteer;
    let handbrake = this.k('Space'), horn = this.k('KeyH'), lookBack = this.k('KeyB');

    // gamepad (standard mapping)
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] ?? 0;
      const dz = Math.abs(ax) < 0.12 ? 0 : (ax - Math.sign(ax) * 0.12) / 0.88;
      const rt = gp.buttons[7]?.value ?? 0, lt = gp.buttons[6]?.value ?? 0;
      if (Math.abs(dz) > 0.01 || rt > 0.02 || lt > 0.02) this.usingGamepad = true;
      if (this.usingGamepad) {
        steer = Math.sign(dz) * Math.pow(Math.abs(dz), 1.4);
        throttle = Math.max(throttle, rt);
        brake = Math.max(brake, lt);
      }
      const btn = (i: number) => !!gp.buttons[i]?.pressed;
      handbrake = handbrake || btn(5) || btn(0);
      horn = horn || btn(10) || btn(1);
      lookBack = lookBack || btn(11);
      const edge = (i: number, a: Action) => {
        if (btn(i) && !this.padPrev[i]) this.pressed.add(a);
      };
      edge(12, 'lights'); // d-pad up
      edge(8, 'camera'); // back/select
      edge(3, 'reset'); // Y / triangle
      edge(14, 'indLeft'); // d-pad left
      edge(15, 'indRight'); // d-pad right
      edge(13, 'hazard'); // d-pad down
      edge(9, 'pause'); // start
      // right stick orbits the camera
      const rx = gp.axes[2] ?? 0, ry = gp.axes[3] ?? 0;
      if (Math.abs(rx) > 0.15) this.mouseDX += rx * 600 * dt;
      if (Math.abs(ry) > 0.15) this.mouseDY += ry * 300 * dt;
      for (let i = 0; i < gp.buttons.length; i++) this.padPrev[i] = btn(i);
      break;
    }
    d.throttle = throttle;
    d.brake = brake;
    d.steer = Math.max(-1, Math.min(1, steer));
    d.handbrake = handbrake;
    d.horn = horn;
    d.lookBack = lookBack;
  }

  consumeMouse(): [number, number] {
    const r: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = this.mouseDY = 0;
    return r;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }
}
