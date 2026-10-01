/**
 * Stage 4: build the owner's Mitsubishi Lancer (CS, GLX) and export an optimised GLB.
 * Base mesh: "Mitsubishi Lancer 2005" by 87-Motors (Sketchfab, CC-BY-4.0), edited by scripts/car/editLancer.ts.
 * Output: public/models/lancer.glb (EXT_meshopt_compression, KHR_materials_clearcoat/emissive_strength/ior)
 *
 *   npm run build:car
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, type Material, type Node as GNode } from '@gltf-transform/core';
import { KHRMaterialsClearcoat, KHRMaterialsEmissiveStrength, KHRMaterialsIOR, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { buildLancerNodes } from './car/editLancer';
import { MATERIALS } from '../src/car/builder/materials';
import type { Part } from '../src/car/builder/part';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CAR_OUT = resolve(ROOT, 'public/models/lancer.glb');

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hexLin = (hex: number): [number, number, number] => [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)];

/** Drop unreferenced vertices and quantise normals to int8 (KHR_mesh_quantization). */
function compact(p: Part): { pos: Float32Array; nor: Int8Array; uv: Float32Array; idx: Uint32Array | Uint16Array } | null {
  if (!p.idx.length) return null;
  const remap = new Int32Array(p.pos.length / 3).fill(-1);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const idx: number[] = [];
  for (const i of p.idx) {
    if (remap[i] < 0) {
      remap[i] = pos.length / 3;
      pos.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
      const nx = p.nor[i * 3], ny = p.nor[i * 3 + 1], nz = p.nor[i * 3 + 2];
      const L = Math.hypot(nx, ny, nz) || 1;
      nor.push(Math.round((nx / L) * 127), Math.round((ny / L) * 127), Math.round((nz / L) * 127));
      uv.push(p.uv[i * 2], p.uv[i * 2 + 1]);
    }
    idx.push(remap[i]);
  }
  // repair zero-length normals (the base mesh has a few; normalize(0) in the shader gives NaN pixels,
  // which bloom spreads into full-screen black flashes) from the adjacent face normals
  const acc = new Float64Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      acc[k * 3] += fx;
      acc[k * 3 + 1] += fy;
      acc[k * 3 + 2] += fz;
    }
  }
  let repaired = 0;
  for (let v = 0; v < nor.length / 3; v++) {
    if (Math.hypot(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]) > 60) continue;
    let fx = acc[v * 3], fy = acc[v * 3 + 1], fz = acc[v * 3 + 2];
    let L = Math.hypot(fx, fy, fz);
    if (L < 1e-12) {
      fx = 0;
      fy = 1;
      fz = 0;
      L = 1;
    }
    nor[v * 3] = Math.round((fx / L) * 127);
    nor[v * 3 + 1] = Math.round((fy / L) * 127);
    nor[v * 3 + 2] = Math.round((fz / L) * 127);
    repaired++;
  }
  if (repaired) console.log(`[build-car] ${p.name}: repaired ${repaired} zero-length normals`);
  // drop degenerate triangles
  const clean: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) continue;
    clean.push(a, b, c);
  }
  const n = pos.length / 3;
  return { pos: new Float32Array(pos), nor: new Int8Array(nor), uv: new Float32Array(uv), idx: n > 65535 ? new Uint32Array(clean) : new Uint16Array(clean) };
}

export async function buildCar(): Promise<void> {
  const t0 = Date.now();
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const { nodes, info } = await buildLancerNodes();
  console.log('[build-car] fit info', JSON.stringify(info));
  const doc = new Document();
  doc.createBuffer();
  const clearcoatExt = doc.createExtension(KHRMaterialsClearcoat);
  const emissiveExt = doc.createExtension(KHRMaterialsEmissiveStrength);
  const iorExt = doc.createExtension(KHRMaterialsIOR);
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

  const mats = new Map<string, Material>();
  const material = (name: string) => {
    let m = mats.get(name);
    if (m) return m;
    const def = MATERIALS[name];
    if (!def) throw new Error('unknown material ' + name);
    const [r, g, b] = hexLin(def.color);
    m = doc.createMaterial(name).setBaseColorFactor([r, g, b, def.alpha ?? 1]).setMetallicFactor(def.metallic).setRoughnessFactor(def.roughness).setDoubleSided(def.doubleSided ?? true); // base mesh relies on double-sided shells
    if (def.alpha !== undefined && def.alpha < 1) m.setAlphaMode('BLEND');
    if (def.clearcoat) m.setExtension('KHR_materials_clearcoat', clearcoatExt.createClearcoat().setClearcoatFactor(def.clearcoat).setClearcoatRoughnessFactor(def.clearcoatRoughness ?? 0.05));
    if (def.emissive !== undefined) {
      m.setEmissiveFactor(hexLin(def.emissive));
      m.setExtension('KHR_materials_emissive_strength', emissiveExt.createEmissiveStrength().setEmissiveStrength(Math.max(def.emissiveStrength ?? 1, 0.0)));
    }
    if (def.ior) m.setExtension('KHR_materials_ior', iorExt.createIOR().setIOR(def.ior));
    mats.set(name, m);
    return m;
  };

  const byName = new Map<string, GNode>();
  const scene = doc.createScene('Lancer');
  let tris = 0, verts = 0;
  for (const nd of nodes) {
    const node = doc.createNode(nd.name);
    if (nd.translation) node.setTranslation(nd.translation);
    if (nd.rotation) node.setRotation(nd.rotation);
    if (nd.parts.length) {
      const mesh = doc.createMesh(nd.name);
      // merge parts sharing a material into one primitive
      const groups = new Map<string, Part[]>();
      for (const p of nd.parts) {
        if (!groups.has(p.material)) groups.set(p.material, []);
        groups.get(p.material)!.push(p);
      }
      for (const [matName, ps] of groups) {
        const merged = ps[0];
        for (let i = 1; i < ps.length; i++) merged.merge(ps[i]);
        const c = compact(merged);
        if (!c) continue;
        const prim = doc
          .createPrimitive()
          .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(c.pos))
          .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(c.nor).setNormalized(true))
          .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(c.uv))
          .setIndices(doc.createAccessor().setType('SCALAR').setArray(c.idx))
          .setMaterial(material(matName));
        mesh.addPrimitive(prim);
        tris += c.idx.length / 3;
        verts += c.pos.length / 3;
      }
      node.setMesh(mesh);
    }
    byName.set(nd.name, node);
    if (nd.parent) byName.get(nd.parent)!.addChild(node);
    else scene.addChild(node);
  }
  const io = new NodeIO().registerExtensions([KHRMaterialsClearcoat, KHRMaterialsEmissiveStrength, KHRMaterialsIOR, EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  const glb = await io.writeBinary(doc);
  mkdirSync(dirname(CAR_OUT), { recursive: true });
  writeFileSync(CAR_OUT, glb);
  const size = statSync(CAR_OUT).size;
  console.log(`[build-car] ${nodes.length} nodes, ${mats.size} materials, ${verts} vertices, ${tris} triangles → ${(size / 1e6).toFixed(2)} MB (${CAR_OUT}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (size > 10e6) throw new Error('GLB exceeds the 10 MB budget');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildCar().catch((err) => {
    console.error('[build-car] FAILED:', err);
    process.exit(1);
  });
}
