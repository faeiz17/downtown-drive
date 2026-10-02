// Arcade drivetrain: a tuned 2.0 turbo four (about 410 hp) through a 6-speed sequential gearbox that shifts by itself,
// all-wheel drive with a rear bias, launch slip, a bouncing rev limiter, turbo spool and nitrous.
// This is deliberately NOT the stock 1.6 automatic: the game is tuned to feel like an arcade street racer.

export type GearMode = 'R' | 'N' | 'D';

/** Engine torque (Nm) at full boost. Peak 480 Nm at 5000 rpm, ~410 hp at 7000 rpm. */
const TORQUE_CURVE: [number, number][] = [
  [0, 0], [900, 170], [2000, 250], [3000, 390], [4000, 465], [5000, 480], [6000, 465], [7000, 420], [7600, 385], [8200, 320],
];

function curve(rpm: number): number {
  const c = TORQUE_CURVE;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
    }
  }
  return c[c.length - 1][1];
}

const RAD_TO_RPM = 60 / (2 * Math.PI);

export class Drivetrain {
  readonly ratios = [3.1, 2.05, 1.5, 1.17, 0.94, 0.73];
  readonly reverseRatio = 3.0;
  readonly finalDrive = 3.9;
  readonly efficiency = 0.9;
  readonly idle = 950;
  readonly redline = 7600;
  readonly limiter = 7900;
  /** share of drive torque sent to the front axle (rear-biased AWD) */
  readonly frontSplit = 0.34;
  readonly launchRpm = 4700;

  mode: GearMode = 'D';
  gear = 1; // 1..6 in D
  rpm = 950;
  shiftTimer = 0; // > 0 while a shift is in progress (torque cut)
  private shiftCooldown = 0;
  lastShift: 'up' | 'down' | null = null;
  /** counts shifts so audio/HUD can react to each one */
  shiftCount = 0;
  torqueOut = 0; // engine torque (Nm) last step, for audio load
  throttleEff = 0;
  /** turbo spool 0..1 (lags the throttle) */
  boost = 0;
  /** true for a moment each time the limiter cuts */
  limiting = false;
  private limiterCut = 0;
  /** nitrous: 1.0 = no nitrous */
  nitroGain = 1;

  get ratio(): number {
    if (this.mode === 'R') return -this.reverseRatio;
    if (this.mode === 'D') return this.ratios[this.gear - 1];
    return 0;
  }

  get gearLabel(): string {
    if (this.mode === 'D') return String(this.gear);
    return this.mode;
  }

  /** Road speed (m/s) at which gear g (1-based) reaches the given rpm. */
  speedAt(g: number, rpm: number, wheelRadius: number): number {
    return (rpm / RAD_TO_RPM / (this.ratios[g - 1] * this.finalDrive)) * wheelRadius;
  }

  /**
   * Advance the drivetrain. wheelOmega = torque-weighted mean angular velocity of the driven wheels (rad/s, + forward).
   * Returns the total drive torque at the wheels (Nm, + = forward); the caller splits it front/rear.
   */
  step(dt: number, throttle: number, wheelOmega: number, speed: number, braking: boolean): number {
    const ratio = this.ratio;
    const overall = Math.abs(ratio * this.finalDrive);
    const coupled = Math.abs(wheelOmega) * overall * RAD_TO_RPM;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);

    // --- automatic sequential shifting on engine speed
    if (this.mode === 'D' && this.shiftCooldown <= 0) {
      const g = this.gear;
      const upAt = 3600 + (this.redline - 250 - 3600) * Math.min(1, throttle * 1.15);
      if (g < this.ratios.length && coupled > upAt && throttle > 0.05) this.shift(g + 1);
      else if (g > 1) {
        const lower = (coupled * this.ratios[g - 2]) / this.ratios[g - 1]; // rpm after a downshift
        // kick-down on full throttle, eager downshifts under braking (engine braking + the sound of it), lazy otherwise
        const downBelow = throttle > 0.85 ? 6300 : braking ? 6600 : 3300;
        const minRpm = throttle > 0.85 ? 5200 : braking ? 5600 : 2100;
        if (lower < downBelow && coupled < minRpm) this.shift(g - 1);
      }
    }

    // reverse is limited: throttle fades out above ~55 km/h
    if (this.mode === 'R') throttle *= Math.max(0, Math.min(1, 1 - (Math.abs(speed) - 14) / 3));

    // --- engine speed: locked to the wheels once they are fast enough, slipping clutch below that (launch)
    const inGear = this.mode === 'D' || this.mode === 'R';
    const free = this.idle + throttle * ((inGear ? this.launchRpm : this.limiter) - this.idle);
    let target = inGear ? Math.max(coupled, free) : free;
    if (this.shiftTimer > 0) target = Math.max(coupled, this.idle); // revs fall/rise to the new gear during the shift
    const rate = target > this.rpm ? 16 : this.shiftTimer > 0 ? 22 : 9;
    this.rpm += (target - this.rpm) * Math.min(1, rate * dt);
    this.rpm = Math.max(this.idle * 0.95, Math.min(this.limiter + 60, this.rpm));

    // --- rev limiter: hard cut that bounces
    this.limiterCut = Math.max(0, this.limiterCut - dt);
    if (this.rpm >= this.limiter) this.limiterCut = 0.055;
    this.limiting = this.limiterCut > 0;

    // --- turbo: boost follows the throttle with a little lag, quicker at high rpm
    const spoolTarget = throttle * Math.min(1, Math.max(0, (this.rpm - 1800) / 2200));
    const spoolRate = spoolTarget > this.boost ? 3.2 + this.rpm / 2500 : 7;
    this.boost += (spoolTarget - this.boost) * Math.min(1, spoolRate * dt);

    // --- torque
    const throttleEff = this.limiting ? 0 : throttle;
    this.throttleEff = throttleEff;
    let tq = curve(this.rpm) * throttleEff * (0.62 + 0.38 * this.boost) * this.nitroGain;
    if (throttleEff < 0.05) tq -= (30 + this.rpm * 0.011) * Math.min(1, (this.rpm - this.idle) / 1500); // engine braking
    this.torqueOut = tq;
    if (!inGear) return 0;
    const cut = this.shiftTimer > 0 ? 0.15 : 1;
    return tq * ratio * this.finalDrive * this.efficiency * cut;
  }

  private shift(to: number) {
    this.lastShift = to > this.gear ? 'up' : 'down';
    this.gear = to;
    this.shiftTimer = 0.11;
    this.shiftCooldown = this.lastShift === 'up' ? 0.32 : 0.22;
    this.shiftCount++;
  }

  setMode(m: GearMode) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'D') this.gear = 1;
    this.shiftTimer = 0.12;
    this.shiftCount++;
  }
}
