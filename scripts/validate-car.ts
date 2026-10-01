/**
 * Checks public/models/lancer.glb: size budget, required node names, meshopt compression.
 *   npm run validate:car
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GLB = resolve(dirname(fileURLToPath(import.meta.url)), '../public/models/lancer.glb');
const REQUIRED = [
  'WheelMount_FL', 'WheelMount_FR', 'WheelMount_RL', 'WheelMount_RR',
  'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR',
  'SteerPivot_FL', 'SteerPivot_FR',
  'SteeringWheel',
  'Headlight_L', 'Headlight_R',
  'TailLight_L', 'TailLight_R',
  'BrakeLight_L', 'BrakeLight_R',
  'ReverseLight_L', 'ReverseLight_R',
  'Indicator_FL', 'Indicator_FR', 'Indicator_RL', 'Indicator_RR',
  'Glass_Windshield', 'Glass_Rear', 'Glass_Sunroof',
  'Plate_Front', 'Plate_Rear',
  'Spoiler',
];

const buf = readFileSync(GLB);
if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a GLB');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString()) as {
  extensionsUsed?: string[];
  nodes?: { name?: string }[];
};
const names = new Set((json.nodes ?? []).map((n) => n.name).filter(Boolean) as string[]);
const missing = REQUIRED.filter((n) => !names.has(n));
const size = statSync(GLB).size;
const problems: string[] = [];
if (missing.length) problems.push('missing nodes: ' + missing.join(', '));
if (size > 10e6) problems.push(`GLB is ${(size / 1e6).toFixed(2)} MB (budget 10 MB)`);
if (!(json.extensionsUsed ?? []).includes('EXT_meshopt_compression')) problems.push('EXT_meshopt_compression not used');
if (problems.length) {
  console.error('[validate-car] FAIL\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`[validate-car] ok — ${names.size} nodes, ${(size / 1e6).toFixed(2)} MB, meshopt`);
