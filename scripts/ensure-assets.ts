/**
 * Makes `npm run dev` and `npm run build` self-contained.
 * Rebuilds the OSM world and the Lancer GLB when their sources are newer than the outputs.
 * The Sketchfab base mesh is shipped in the repo (CC-BY-4.0); OSM is fetched only if the cache is missing.
 */
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OSM_CACHE, fetchOsm } from './fetch-osm';
import { WORLD_OUT, buildWorld } from './build-world';
import { CAR_OUT, buildCar } from './build-car';
import { BASE_GLB } from './car/base';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function olderThan(out: string, sources: string[]): boolean {
  const o = statSync(out).mtimeMs;
  return sources.some((s) => existsSync(s) && statSync(s).mtimeMs > o);
}

async function main(): Promise<void> {
  if (!existsSync(BASE_GLB)) {
    throw new Error(`Base car mesh missing: ${BASE_GLB}\nIt is the Sketchfab model "Mitsubishi Lancer 2005" by 87-Motors (CC-BY-4.0) and must be present to rebuild the GLB.`);
  }
  if (!existsSync(OSM_CACHE)) {
    console.log('[ensure] OSM cache missing — fetching Gulberg from Overpass');
    await fetchOsm();
  } else console.log('[ensure] OSM cache present');

  if (!existsSync(WORLD_OUT) || olderThan(WORLD_OUT, [OSM_CACHE, resolve(ROOT, 'scripts/build-world.ts')])) {
    console.log('[ensure] building world');
    await buildWorld();
  } else console.log('[ensure] world is current');

  const carSources = [
    BASE_GLB,
    resolve(ROOT, 'scripts/car/editLancer.ts'),
    resolve(ROOT, 'scripts/build-car.ts'),
    resolve(ROOT, 'src/car/builder/materials.ts'),
    resolve(ROOT, 'src/car/builder/wheels.ts'),
    resolve(ROOT, 'src/car/spec.ts'),
  ];
  if (!existsSync(CAR_OUT) || olderThan(CAR_OUT, carSources)) {
    console.log('[ensure] building Lancer GLB');
    await buildCar();
  } else console.log('[ensure] car GLB is current');
}

main().catch((err) => {
  console.error('[ensure] FAILED:', err);
  process.exit(1);
});
