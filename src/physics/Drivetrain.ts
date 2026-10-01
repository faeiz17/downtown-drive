// 4G18 1.6 L engine + torque converter + 4-speed automatic (INVECS-II style) with P/R/N/D logic.
// Published: 105 hp @ 6000 rpm, 150 Nm @ 4500 rpm, top speed 180 km/h (Pakistan-market GLX SR 1.6 AT).

export type GearMode = 'P' | 'R' | 'N' | 'D';

const TORQUE_CURVE: [number, number][] = [
  [0, 0], [700, 95], [1000, 105], [2000, 122], [3000, 136], [4000, 147], [4500, 150], [5000, 146], [5500, 138], [6000, 125], [6500, 110], [7000, 90],
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

export class Drivetrain {
  readonly ratios = [2.842, 1.529, 1.0, 0.712];
  readonly reverseRatio = 2.48;
  readonly finalDrive = 4.042;
  readonly efficiency = 0.92;
  readonly idle = 780;
  readonly redline = 6500;
  readonly limiter = 6700;
  readonly stallRpm = 2700;

  mode: GearMode = 'D';
  gear = 1; // 1..4 in D
  rpm = 780;
  shiftTimer = 0; // > 0 while a shift is in progress (torque cut)
  private shiftCooldown = 0;
  lastShift: 'up' | 'down' | null = null;
  torqueOut = 0; // engine torque (Nm) last step, for audio load
  throttleEff = 0;

  get ratio(): number {
    if (this.mode === 'R') return -this.reverseRatio;
    if (this.mode === 'D') return this.ratios[this.gear - 1];
    return 0;
  }

  get gearLabel(): string {
    // Drive is fully automatic — the dash shows D, not a gear the player selects.
    if (this.mode === 'D') return 'D';
    return this.mode;
  }

  /**
   * Advance the drivetrain. wheelOmega = mean angular velocity of the driven (front) wheels (rad/s, + forward).
   * Returns the total drive torque at the driven axle (Nm, + = forward).
   */
  step(dt: number, throttle: number, wheelOmega: number, speed: number): number {
    const ratio = this.ratio;
    const turbineRpm = Math.abs(wheelOmega * ratio * this.finalDrive) * (60 / (2 * Math.PI));
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);

    // Automatic only. Shift on road speed so the converter can't make it hunt.
    // Light throttle short-shifts; full throttle holds each gear a little longer.
    if (this.mode === 'D' && this.shiftCooldown <= 0) {
      const kmh = Math.abs(speed) * 3.6;
      const upAt = [0, 56, 106, 162]; // full-throttle upshift speeds (km/h); light throttle short-shifts at 70 %
      const downAt = [0, 0, 24, 72, 130];
      const up = upAt[this.gear] * (0.7 + 0.3 * throttle);
      if (this.gear < 4 && (kmh > up || turbineRpm > 6100)) this.shift(this.gear + 1);
      else if (this.gear > 1 && kmh < downAt[this.gear]) this.shift(this.gear - 1);
      else if (this.gear > 1 && throttle > 0.9 && kmh < upAt[this.gear - 1] * 0.8 && turbineRpm < 4200) this.shift(this.gear - 1);
    }

    // reverse is limited like most games (and most sane drivers): throttle fades out above ~30 km/h
    if (this.mode === 'R') throttle *= Math.max(0, Math.min(1, 1 - (Math.abs(speed) - 7.5) / 2));

    // engine speed: torque converter lets the engine rise towards stall speed while the turbine is slow
    const inGear = this.mode === 'D' || this.mode === 'R';
    const freeRev = this.idle + throttle * (inGear ? this.stallRpm - this.idle : this.limiter - this.idle);
    // at full throttle the engine flares to the converter's stall speed and holds there while the turbine catches up;
    // above that it runs a few percent ahead of the turbine (converter slip grows with throttle)
    let target = inGear ? Math.max(turbineRpm * (1.03 + 0.07 * throttle) + 120 * throttle, freeRev, this.idle) : freeRev;
    if (this.shiftTimer > 0) target = this.rpm; // hold during the shift
    const rate = target > this.rpm ? 9 : 6;
    this.rpm += (target - this.rpm) * Math.min(1, rate * dt);
    this.rpm = Math.max(this.idle * 0.95, Math.min(this.limiter, this.rpm));

    // engine torque (limiter cuts fuel), engine braking off-throttle
    let throttleEff = throttle;
    if (this.rpm >= this.limiter - 20) throttleEff = 0;
    this.throttleEff = throttleEff;
    let tq = curve(this.rpm) * throttleEff;
    if (throttleEff < 0.05) tq -= 18 * Math.min(1, (this.rpm - this.idle) / 3000);
    this.torqueOut = tq;
    if (!inGear) return 0;

    // converter torque multiplication (up to 2.45× at stall), fully coupled above 85% speed ratio
    const sr = Math.min(1, turbineRpm / Math.max(1, this.rpm));
    const tr = sr < 0.85 ? 2.45 - (sr / 0.85) * 1.45 : 1.0;
    const cut = this.shiftTimer > 0 ? 0.35 : 1;
    let axle = tq * (tq > 0 ? tr : 1) * ratio * this.finalDrive * this.efficiency * cut;
    // creep at idle in gear (automatic)
    if (throttle < 0.05 && Math.abs(speed) < 2.5) axle += Math.sign(ratio) * 220 * (1 - Math.abs(speed) / 2.5);
    return axle;
  }

  private shift(to: number) {
    this.lastShift = to > this.gear ? 'up' : 'down';
    this.gear = to;
    this.shiftTimer = 0.32;
    this.shiftCooldown = 0.9;
  }

  setMode(m: GearMode) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'D') this.gear = 1;
    this.shiftTimer = 0.25;
  }
}
