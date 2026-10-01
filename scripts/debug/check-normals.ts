import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2] ?? 'public/models/lancer.glb');
let bad = 0, total = 0, nanPos = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) {
    const N = prim.getAttribute('NORMAL'), P = prim.getAttribute('POSITION')!;
    const t: number[] = [];
    let b = 0;
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, t);
      if (t.some((v) => !Number.isFinite(v))) nanPos++;
      if (!N) continue;
      N.getElement(i, t);
      const L = Math.hypot(t[0], t[1], t[2]);
      if (!(L > 0.5)) b++;
    }
    total += P.getCount();
    if (b) console.log(`${node.getName()} / ${prim.getMaterial()?.getName()}: ${b} zero/short normals of ${P.getCount()}`);
    bad += b;
  }
}
console.log({ total, bad, nanPos });
