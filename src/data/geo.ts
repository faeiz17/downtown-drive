// Geographic configuration shared by the build scripts (Node) and the game (browser).
// Coordinate system used everywhere in the game: X = east, Y = up, Z = south (so north is -Z), metres.

export const BBOX = {
  // Requested box was 31.500–31.535 / 74.330–74.365. Kalma Chowk (31.5048, 74.3317) sat only
  // ~150 m inside the west edge, so the box was widened south/west and trimmed east (see README).
  south: 31.498,
  west: 74.325,
  north: 31.535,
  east: 74.362,
} as const;

export const ORIGIN = {
  lat: (BBOX.south + BBOX.north) / 2,
  lon: (BBOX.west + BBOX.east) / 2,
} as const;

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** Equirectangular projection about the bbox centre. Error is < 0.1% across a 4 km area. */
export function project(lat: number, lon: number): [number, number] {
  const x = (lon - ORIGIN.lon) * M_PER_DEG_LON;
  const z = -(lat - ORIGIN.lat) * M_PER_DEG_LAT;
  return [x, z];
}

export function unproject(x: number, z: number): [number, number] {
  return [ORIGIN.lat - z / M_PER_DEG_LAT, ORIGIN.lon + x / M_PER_DEG_LON];
}

export const EXTENT = (() => {
  const [minX, maxZ] = project(BBOX.south, BBOX.west);
  const [maxX, minZ] = project(BBOX.north, BBOX.east);
  return { minX, maxX, minZ, maxZ };
})();

/** Lahore, for solar position. */
export const LAHORE = { lat: 31.52, lon: 74.35, utcOffsetHours: 5 } as const;

/** Landmarks the data pipeline must find (validated by fetch-osm and build-world). */
export const REQUIRED_LANDMARKS = [
  { name: 'Main Boulevard Gulberg', kind: 'road' },
  { name: 'MM Alam Road', kind: 'road' },
  { name: 'Liberty Chowk', kind: 'place' },
  { name: 'Kalma Chowk', kind: 'place' },
  { name: 'Hussain Chowk', kind: 'place' },
] as const;
