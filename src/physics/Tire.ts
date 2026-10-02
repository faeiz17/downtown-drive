// Combined-slip tyre model (Pacejka "magic formula" shape on a friction ellipse), tuned for arcade handling:
// lots of grip, a sharp response around centre, and a wide plateau past the peak so slides stay catchable and
// drifting costs little speed.

export interface TireForces {
  fx: number; // longitudinal (N, + forward)
  fy: number; // lateral (N, + towards wheel's left)
  slip: number; // combined normalised slip (0 = rolling, ~1 = at peak, >1 sliding)
  dFxdOmega: number; // ∂Fx/∂ω for the implicit wheel-spin integration
}

export const TIRE = {
  B: 16, // stiffness: peak at a slip of ~0.13 (about 8° of slip angle)
  C: 1.4, // shape: 81 % of peak grip is left in a full slide
  peakSlip: 0.13, // slip at peak (for normalisation)
  muRoad: 1.55,
  muWet: 1.32, // rain: a little less grip, same character
  muGrass: 0.95,
  loadSens: 0.03, // μ drops with load (per kN above 4 kN)
};

const mf = (s: number) => Math.sin(TIRE.C * Math.atan(TIRE.B * s));

/**
 * vLong / vLat = contact patch velocity in the wheel frame (m/s), omegaR = wheel surface speed (ω·R).
 * fz = normal load (N), mu = surface friction, latScale = lateral grip multiplier (drift / handbrake).
 */
export function tireForces(vLong: number, vLat: number, omegaR: number, fz: number, mu: number, radius: number, latScale = 1): TireForces {
  if (fz <= 0) return { fx: 0, fy: 0, slip: 0, dFxdOmega: 0 };
  const denom = Math.max(Math.abs(vLong), 2.0);
  const kappa = (omegaR - vLong) / denom; // slip ratio
  const tanA = vLat / Math.max(Math.abs(vLong), 0.8); // slip angle (tan)
  // combined slip vector normalised by the peak
  const sx = kappa, sy = Math.atan(tanA) * 0.9;
  const s = Math.hypot(sx, sy);
  const muEff = mu * (1 - TIRE.loadSens * Math.max(0, fz / 1000 - 4));
  const fMax = muEff * fz;
  let fx = 0, fy = 0;
  if (s > 1e-6) {
    const f = fMax * mf(s);
    fx = (f * sx) / s;
    fy = (-f * sy) / s * latScale;
  }
  // derivative of fx wrt ω (small-slip linearisation, keeps the implicit solver stable)
  const dfds = fMax * TIRE.B * TIRE.C / (1 + (TIRE.B * s) ** 2) * Math.cos(TIRE.C * Math.atan(TIRE.B * s));
  const dFxdOmega = Math.max(0, dfds) * (radius / denom);
  return { fx, fy, slip: s / TIRE.peakSlip / 1.4, dFxdOmega };
}
