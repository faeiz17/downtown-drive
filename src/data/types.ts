// Compiled world format (public/world/gulberg.world.json), produced by scripts/build-world.ts.
// All coordinates are local metres: X = east, Z = south. Polylines are flat [x0,z0,x1,z1,...].

export type RoadClass = 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'service' | 'link';

export interface RoadEdge {
  id: number;
  a: number; // graph node index at pts start
  b: number; // graph node index at pts end
  pts: number[];
  name?: string;
  cls: RoadClass;
  width: number; // carriageway width (m)
  lanesF: number; // lanes travelling a→b (0 = not allowed)
  lanesB: number; // lanes travelling b→a
  oneway: boolean;
  roundabout?: boolean;
  dual?: boolean; // one half of a dual carriageway
  median?: number; // raised central median width (single two-way ways)
  speed: number; // km/h
  stroke: number; // index into strokes
  sidewalk: number; // sidewalk width each side (0 = grass verge with yellow curb)
}

export interface GraphNode {
  x: number;
  z: number;
  edges: number[];
  r: number; // junction radius (0 for simple continuations)
  signal?: number; // signal cluster id (nodes of one chowk share a phase clock)
  name?: string; // named chowk
}

/** A render chain of edges joined through degree-2 nodes with matching attributes. */
export interface Stroke {
  id: number;
  edges: number[];
  pts: number[];
  cls: RoadClass;
  width: number;
  sidewalk: number;
  oneway: boolean;
  lanes: number; // total lanes
  name?: string;
  closed?: boolean;
  trimStart: number; // metres of stroke start inside a junction (no curbs/markings)
  trimEnd: number;
  median?: number;
  dual?: boolean;
  /** For dual carriageways: which side the median is on relative to stroke direction (+1 left, -1 right). */
  medianSide?: number;
}

export interface MedianStrip {
  l: number[]; // one edge of the median
  r: number[]; // the other edge (same vertex count)
  width: number; // typical width
}

export interface Island {
  x: number;
  z: number;
  r: number;
  name?: string;
}

export type AreaKind = 'park' | 'grass' | 'golf' | 'pitch' | 'cemetery' | 'water' | 'parking' | 'campus' | 'plaza';

export interface Area {
  kind: AreaKind;
  pts: number[]; // CCW ring (open)
  name?: string;
}

export interface WaterLine {
  pts: number[];
  width: number;
  kind: 'canal' | 'drain';
}

export type BuildingKind = 'commercial' | 'residential' | 'civic' | 'religious' | 'stadium' | 'canopy' | 'industrial';

export interface Building {
  id: number;
  pts: number[]; // CCW ring (open)
  h: number; // total wall height (m)
  levels: number;
  kind: BuildingKind;
  name?: string;
  osm: boolean; // true = real OSM footprint, false = procedural infill
}

/** Procedural plot: [x, z, angle, frontage, depth, kind(0=res,1=com), floors, seed] */
export const PLOT_STRIDE = 8;
/** Trees: [x, z, type, scale*100, rotDeg] */
export const TREE_STRIDE = 5;
/** Lamps: [x, z, rotY*100, type(0 single-arm,1 double-arm median,2 residential)] */
export const LAMP_STRIDE = 4;
/** Poles: [x, z, rotY*100, chain, lamp(0/1), transformer(0/1)] */
export const POLE_STRIDE = 6;
/** Billboards: [x, z, rotY*100, adIndex] */
export const BILLBOARD_STRIDE = 4;

export interface Shop {
  x: number;
  z: number;
  name: string;
  kind: string;
}

export interface WorldData {
  version: number;
  generated: string;
  osmBase?: string;
  attribution: string;
  origin: { lat: number; lon: number };
  extent: { minX: number; maxX: number; minZ: number; maxZ: number };
  nodes: GraphNode[];
  edges: RoadEdge[];
  strokes: Stroke[];
  medians: MedianStrip[];
  islands: Island[];
  areas: Area[];
  water: WaterLine[];
  rail: number[][];
  buildings: Building[];
  plots: number[];
  trees: number[];
  lamps: number[];
  poles: number[];
  billboards: number[];
  shops: Shop[];
  landmarks: { name: string; x: number; z: number }[];
  spawn: { x: number; z: number; heading: number };
  stats: Record<string, number>;
}

export const TREE_TYPES = { broadleaf: 0, palm: 1, ashoka: 2, banyan: 3 } as const;
