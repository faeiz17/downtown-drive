// Mitsubishi Lancer CS (2004–07 facelift, Pakistan-market GLX SR) – dimensions used by the model, physics and cameras.
// glTF convention: +X = car's LEFT, +Y up, +Z forward. Origin: ground level, centre of the wheelbase.
// Published: 4480 × 1695 × 1445 mm, wheelbase 2600 mm, 185/60 R15, 1225 kg (PakWheels).
// Wheel positions below are measured from the base mesh's wheel arches (scripts/debug/analyze-arch.ts).

export const SPEC = {
  length: 4.44,
  width: 1.71,
  height: 1.39,
  wheelbase: 2.59,
  track: 1.47,
  tireRadius: 0.3015, // 185/60 R15
  tireWidth: 0.185,
  rimRadius: 0.1905, // 15"
  wheelY: 0.3015,
  massKg: 1225,
  paint: 0x1d3658, // measured from overcast door/quarter-panel crops (#203c5d, #1e2e45)
  plate: 'DAK 539',
};

export const Z_FRONT_AXLE = 1.295;
export const Z_REAR_AXLE = -1.295;

export const WHEELS = [
  { name: 'FL', x: SPEC.track / 2, z: Z_FRONT_AXLE, front: true },
  { name: 'FR', x: -SPEC.track / 2, z: Z_FRONT_AXLE, front: true },
  { name: 'RL', x: SPEC.track / 2, z: Z_REAR_AXLE, front: false },
  { name: 'RR', x: -SPEC.track / 2, z: Z_REAR_AXLE, front: false },
] as const;

/** Driver's eye point for the interior camera. Right-hand drive (Pakistan) → negative X. */
export const DRIVER_EYE = { x: -0.4, y: 1.13, z: -0.12 };
