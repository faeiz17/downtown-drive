// Green areas, water, rail, parking and landuse polygons.
import type { Area, AreaKind, WaterLine } from '../../src/data/types';
import { centroid, signedArea, simplify } from '../../src/core/geom2d';
import { displayName, inExtent, normalizeRing, type ParsedOsm } from './osm';
import { round1 } from './roads';

export interface AreaSet {
  areas: Area[];
  water: WaterLine[];
  rail: number[][];
  commercialZones: number[][]; // landuse=commercial/retail rings (for infill classification)
  noBuildZones: number[][]; // rings where infill must not place plots (campuses, cemeteries, sports grounds…)
  treeRows: number[][];
}

function areaKind(t: Record<string, string>): AreaKind | null {
  if (t.leisure === 'golf_course') return 'golf';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground' || t.leisure === 'common') return 'park';
  if (t.leisure === 'pitch' || t.leisure === 'sports_centre' || t.leisure === 'stadium' || t.leisure === 'track') return 'pitch';
  if (t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.landuse === 'village_green' || t.landuse === 'flowerbed' || t.landuse === 'meadow')
    return 'grass';
  if (t.natural === 'grassland' || t.natural === 'scrub' || t.natural === 'wood' || t.landuse === 'forest') return 'grass';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.leisure === 'swimming_pool') return 'water';
  if (t.amenity === 'parking') return 'parking';
  if (['school', 'college', 'university', 'hospital'].includes(t.amenity ?? '') || t.landuse === 'education') return 'campus';
  if (t.highway === 'pedestrian' && t.area === 'yes') return 'plaza';
  return null;
}

export function buildAreas(osm: ParsedOsm): AreaSet {
  const areas: Area[] = [];
  const water: WaterLine[] = [];
  const rail: number[][] = [];
  const commercialZones: number[][] = [];
  const noBuildZones: number[][] = [];
  const treeRows: number[][] = [];

  const addRing = (ringIn: number[], t: Record<string, string>) => {
    const ring = normalizeRing(simplify(ringIn, 0.4));
    if (ring.length < 6) return;
    const [cx, cz] = centroid(ring);
    if (!inExtent(cx, cz, 200)) return;
    const a = Math.abs(signedArea(ring));
    if (a < 20) return;
    const r = ring.map(round1);
    if (t.landuse === 'commercial' || t.landuse === 'retail') commercialZones.push(r);
    const kind = areaKind(t);
    if (!kind) return;
    if (kind !== 'parking' && kind !== 'plaza') noBuildZones.push(r);
    areas.push({ kind, pts: r, name: displayName(t) });
  };

  for (const w of osm.ways) {
    const t = w.tags;
    if (t.building) continue;
    if (t.waterway === 'canal' || t.waterway === 'river' || t.waterway === 'drain' || t.waterway === 'ditch') {
      const pts = simplify(w.pts, 0.5).map(round1);
      if (t.tunnel && t.tunnel !== 'no') continue;
      water.push({ pts, width: t.waterway === 'canal' || t.waterway === 'river' ? 16 : 4, kind: t.waterway === 'canal' || t.waterway === 'river' ? 'canal' : 'drain' });
      continue;
    }
    if (t.railway === 'rail' && !(t.tunnel && t.tunnel !== 'no')) {
      rail.push(simplify(w.pts, 0.3).map(round1));
      continue;
    }
    if (t.natural === 'tree_row') {
      treeRows.push(w.pts.map(round1));
      continue;
    }
    if (w.closed) addRing(w.pts, t);
  }
  for (const r of osm.relations) {
    for (const ring of r.outers) addRing(ring, r.tags);
  }
  return { areas, water, rail, commercialZones, noBuildZones, treeRows };
}
