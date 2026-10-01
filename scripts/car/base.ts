// Load the base Lancer CS mesh (Sketchfab "Mitsubishi Lancer 2005" by 87-Motors, CC-BY-4.0) and bake every
// primitive into car coordinates: +X = car's left, +Y up, +Z forward, metres, ground at y = 0.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Node as GNode } from '@gltf-transform/core';
import * as THREE from 'three';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BASE_GLB = resolve(ROOT, 'assets-src/sketchfab-lancer-2005.glb');

export interface BakedPrim {
  node: string; // source node name (pessima_body, pessima_door_FL, …)
  material: string; // source material name (body1, glass1, …)
  pos: Float32Array;
  nor: Float32Array;
  idx: Uint32Array;
}

export async function loadBase(): Promise<BakedPrim[]> {
  const doc = await new NodeIO().read(BASE_GLB);
  const out: BakedPrim[] = [];
  const world = new Map<GNode, THREE.Matrix4>();
  const matOf = (n: GNode): THREE.Matrix4 => {
    let m = world.get(n);
    if (m) return m;
    const local = new THREE.Matrix4().fromArray(n.getMatrix());
    const parent = n.getParentNode();
    m = parent ? matOf(parent).clone().multiply(local) : local;
    world.set(n, m);
    return m;
  };
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = matOf(node);
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    // the geometry nodes are children named "<material>-material"; use the nearest "pessima_*" ancestor as the part name
    let partNode: GNode | null = node;
    while (partNode && !partNode.getName().startsWith('pessima_')) partNode = partNode.getParentNode();
    const partName = partNode?.getName() ?? node.getName();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION')!;
      const N = prim.getAttribute('NORMAL');
      const I = prim.getIndices();
      const n = P.getCount();
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      const v = new THREE.Vector3(), w = new THREE.Vector3();
      const tmp: number[] = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        P.getElement(i, tmp);
        v.set(tmp[0], tmp[1], tmp[2]).applyMatrix4(m);
        pos.set([v.x, v.y, v.z], i * 3);
        if (N) {
          N.getElement(i, tmp);
          w.set(tmp[0], tmp[1], tmp[2]).applyMatrix3(nm).normalize();
          nor.set([w.x, w.y, w.z], i * 3);
        }
      }
      let idx: Uint32Array;
      if (I) {
        idx = new Uint32Array(I.getCount());
        for (let i = 0; i < idx.length; i++) idx[i] = I.getScalar(i);
      } else {
        idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
      }
      // if the node transform mirrors (negative determinant), flip winding
      if (m.determinant() < 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
      out.push({ node: partName, material: prim.getMaterial()?.getName() ?? 'none', pos, nor, idx });
    }
  }
  return out;
}

export function bounds(prims: BakedPrim[], filter?: (p: BakedPrim) => boolean): THREE.Box3 {
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const p of prims) {
    if (filter && !filter(p)) continue;
    for (let i = 0; i < p.pos.length; i += 3) b.expandByPoint(v.set(p.pos[i], p.pos[i + 1], p.pos[i + 2]));
  }
  return b;
}
