// Real OSM building footprints → cleaned polygons with heights and kinds.
import type { Building, BuildingKind, RoadEdge } from '../../src/data/types';
import { RNG, hash32 } from '../../src/core/rng';
import { centroid, pointInPolygon, signedArea, simplify, distPointSeg, SpatialGrid } from '../../src/core/geom2d';
import { isMajor } from '../../src/data/roadClasses';
import { displayName, inExtent, normalizeRing, parseHeight, type ParsedOsm } from './osm';
import { round1 } from './roads';

const COMMERCIAL = new Set(['commercial', 'retail', 'office', 'hotel', 'supermarket', 'kiosk', 'bank', 'warehouse', 'mall']);
const RESIDENTIAL = new Set(['residential', 'house', 'apartments', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'villa', 'dormitory']);
const CIVIC = new Set(['school', 'college', 'university', 'hospital', 'public', 'government', 'civic', 'train_station', 'transportation', 'kindergarten', 'fire_station', 'police']);
const RELIGIOUS = new Set(['mosque', 'church', 'temple', 'religious', 'shrine', 'chapel', 'gurdwara']);

export function buildOsmBuildings(
  osm: ParsedOsm,
  edges: RoadEdge[],
  segGrid: SpatialGrid<{ edge: number; i: number }>,
  commercialZones: number[][],
  civicAreas: { pts: number[]; kind: string }[],
): Building[] {
  const out: Building[] = [];
  const rings: { ring: number[]; tags: Record<string, string>; id: number }[] = [];
  for (const w of osm.ways) if (w.tags.building && w.closed) rings.push({ ring: w.pts, tags: w.tags, id: w.id });
  for (const r of osm.relations) if (r.tags.building) for (const ring of r.outers) rings.push({ ring, tags: r.tags, id: r.id });

  for (const { ring: raw, tags: t, id } of rings) {
    let ring = normalizeRing(raw);
    ring = simplify(ring.concat(ring.slice(0, 2)), 0.25).slice(0, -2);
    if (ring.length < 6) continue;
    if (signedArea(ring) < 0) continue; // degenerate after simplify
    const area = signedArea(ring);
    if (area < 10) continue;
    const [cx, cz] = centroid(ring);
    if (!inExtent(cx, cz, 0)) continue;
    const rng = new RNG(hash32('bld', id));

    const bt = t.building;
    let kind: BuildingKind;
    if (bt === 'roof' || bt === 'carport') kind = 'canopy';
    else if (bt === 'grandstand' || bt === 'stadium') kind = 'stadium';
    else if (RELIGIOUS.has(bt) || t.amenity === 'place_of_worship') kind = 'religious';
    else if (CIVIC.has(bt) || ['school', 'college', 'university', 'hospital'].includes(t.amenity ?? '')) kind = 'civic';
    else if (bt === 'industrial' || bt === 'factory') kind = 'industrial';
    else if (COMMERCIAL.has(bt) || t.shop || t.amenity === 'bank' || t.amenity === 'restaurant' || t.amenity === 'fast_food') kind = 'commercial';
    else if (RESIDENTIAL.has(bt)) kind = 'residential';
    else {
      // building=yes: infer from context
      const inCivic = civicAreas.find((a) => pointInPolygon(cx, cz, a.pts));
      if (inCivic) kind = inCivic.kind === 'campus' ? 'civic' : 'residential';
      else if (commercialZones.some((z) => pointInPolygon(cx, cz, z))) kind = 'commercial';
      else {
        let nearMajor = false;
        for (const c of segGrid.queryRadius(cx, cz, 40)) {
          const e = edges[c.edge];
          if (!isMajor(e.cls)) continue;
          if (distPointSeg(cx, cz, e.pts[c.i], e.pts[c.i + 1], e.pts[c.i + 2], e.pts[c.i + 3]) < 22 + e.width / 2 + Math.sqrt(area) / 2) {
            nearMajor = true;
            break;
          }
        }
        kind = nearMajor ? 'commercial' : area > 900 ? 'commercial' : 'residential';
      }
    }

    const floorH = kind === 'commercial' ? 3.4 : kind === 'civic' ? 3.6 : 3.2;
    const tagH = parseHeight(t.height);
    let levels = parseInt(t['building:levels'] ?? '', 10);
    if (!isFinite(levels) || levels < 1 || levels > 60) levels = 0;
    let h: number;
    if (tagH && tagH > 2 && tagH < 250) {
      h = tagH;
      levels = levels || Math.max(1, Math.round(h / floorH));
    } else if (levels) {
      h = levels * floorH + (kind === 'commercial' ? 0.8 : 0.5);
    } else {
      switch (kind) {
        case 'commercial':
          levels = area > 1500 ? rng.int(3, 8) : rng.int(2, 6);
          break;
        case 'residential':
          levels = rng.weighted([1, 2, 3], [0.25, 0.55, 0.2]);
          break;
        case 'civic':
          levels = rng.int(2, 4);
          break;
        case 'religious':
          levels = rng.int(1, 2);
          break;
        case 'industrial':
          levels = rng.int(1, 2);
          break;
        default:
          levels = 1;
      }
      h = levels * floorH + 0.5;
    }
    if (kind === 'canopy') h = Math.min(h, 6);
    if (kind === 'stadium') h = Math.max(h, 12);

    out.push({ id, pts: ring.map(round1), h: round1(h), levels, kind, name: displayName(t), osm: true });
  }
  return out;
}
