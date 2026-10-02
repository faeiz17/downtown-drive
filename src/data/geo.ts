// Geographic configuration shared by the build scripts (Node) and the game (browser).
// Coordinate system used everywhere in the game: X = east, Y = up, Z = south (so north is -Z), metres.

export const BBOX = {
  // Downtown Los Angeles: the financial district, Bunker Hill, Staples Center / L.A. Live, the 110 and 101 freeways'
  // surface streets. Dense real footprints (about 5,000 buildings, most with tagged heights) and a proper street grid.
  south: 34.031,
  west: -118.274,
  north: 34.063,
  east: -118.230,
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
export const LAHORE = { lat: 34.047, lon: -118.252, utcOffsetHours: -7 } as const; // Los Angeles (name kept: solar position)

/** +1 drives on the left (Pakistan), −1 on the right (USA). Lane offsets and kerb-side props follow it. */
export const DRIVE_SIDE = -1;

/** Landmarks the data pipeline must find (validated by fetch-osm and build-world). */
export const REQUIRED_LANDMARKS = [] as readonly { name: string; kind: string }[];
