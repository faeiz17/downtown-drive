/**
 * Stage 1: fetch OpenStreetMap data for Gulberg, Lahore from the Overpass API and cache it in the repo.
 * Output: data/osm/gulberg.overpass.json (ODbL, © OpenStreetMap contributors)
 *
 *   npm run fetch:osm            # fetch (skips if the cache exists)
 *   npm run fetch:osm -- --force # refetch
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BBOX, REQUIRED_LANDMARKS } from '../src/data/geo';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OSM_CACHE = resolve(ROOT, 'data/osm/dtla.overpass.json');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const QUERY = `[out:json][timeout:240][bbox:${bbox}];
(
  way["highway"];
  way["building"];
  relation["building"];
  way["building:part"];
  way["landuse"];
  way["leisure"];
  way["natural"];
  way["amenity"];
  way["barrier"];
  way["power"];
  way["railway"];
  way["waterway"];
  way["man_made"];
  way["place"];
  relation["landuse"];
  relation["leisure"];
  node["highway"];
  node["natural"="tree"];
  node["power"];
  node["shop"];
  node["amenity"];
  node["place"];
  node["junction"];
  node["name"~"chowk",i];
  node["tourism"];
  node["office"];
  node["advertising"];
  node["man_made"];
  node["leisure"];
);
out body geom qt;`;

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
}

async function fetchFrom(endpoint: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300_000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data: QUERY }),
      headers: { 'User-Agent': 'gulberg-drive/1.0 (open-source driving game; offline cache build)' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    if (!text.trimStart().startsWith('{')) throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export function validateLandmarks(elements: OverpassElement[]): string[] {
  const names = elements.map((e) => (e.tags?.name ?? '') + ' | ' + (e.tags?.['name:en'] ?? '') + ' | ' + (e.tags?.alt_name ?? ''));
  const missing: string[] = [];
  for (const lm of REQUIRED_LANDMARKS) {
    const pattern =
      lm.name === 'MM Alam Road'
        ? /m\.?\s?m\.?\s?alam/i
        : new RegExp(lm.name.replace(/\s+/g, '\\s*'), 'i');
    if (!names.some((n) => pattern.test(n))) missing.push(lm.name);
  }
  return missing;
}

export async function fetchOsm(force = false): Promise<void> {
  if (existsSync(OSM_CACHE) && !force) {
    console.log(`[fetch-osm] cache exists (${(statSync(OSM_CACHE).size / 1e6).toFixed(1)} MB): ${OSM_CACHE}`);
    return;
  }
  console.log(`[fetch-osm] querying Overpass for bbox ${bbox} …`);
  let text: string | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2 && !text; attempt++) {
    for (const ep of ENDPOINTS) {
      try {
        console.log(`[fetch-osm]   → ${ep}`);
        text = await fetchFrom(ep);
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[fetch-osm]   ✗ ${ep}: ${(err as Error).message}`);
      }
    }
    if (!text) await new Promise((r) => setTimeout(r, 5000));
  }
  if (!text) throw new Error(`All Overpass endpoints failed: ${(lastErr as Error)?.message}`);

  const json = JSON.parse(text) as { elements: OverpassElement[]; osm3s?: { timestamp_osm_base?: string } };
  const missing = validateLandmarks(json.elements);
  if (missing.length) throw new Error(`Overpass data is missing required landmarks: ${missing.join(', ')}`);

  mkdirSync(dirname(OSM_CACHE), { recursive: true });
  const out = {
    source: 'OpenStreetMap via Overpass API',
    license: 'ODbL 1.0: © OpenStreetMap contributors (https://www.openstreetmap.org/copyright)',
    bbox: BBOX,
    fetched: new Date().toISOString(),
    osmBase: json.osm3s?.timestamp_osm_base,
    elements: json.elements,
  };
  writeFileSync(OSM_CACHE, JSON.stringify(out));
  const counts = json.elements.reduce<Record<string, number>>((acc, e) => ((acc[e.type] = (acc[e.type] ?? 0) + 1), acc), {});
  console.log(`[fetch-osm] saved ${json.elements.length} elements ${JSON.stringify(counts)} → ${OSM_CACHE}`);
  console.log(`[fetch-osm] all landmarks present: ${REQUIRED_LANDMARKS.map((l) => l.name).join(', ')}`);
}

export function readOsmCache(): { elements: any[]; osmBase?: string } {
  return JSON.parse(readFileSync(OSM_CACHE, 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchOsm(process.argv.includes('--force')).catch((err) => {
    console.error('[fetch-osm] FAILED:', err);
    process.exit(1);
  });
}
