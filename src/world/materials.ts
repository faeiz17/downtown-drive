// Shared world materials.
import * as THREE from 'three';
import { WorldAtlas, noise } from './atlas';
import { RNG } from '../core/rng';
import { wetUniforms } from '../render/WetReflection';

/** MeshStandardMaterial that samples textures from an atlas cell per vertex (repeating inside the cell). */
export function createAtlasMaterial(atlas: WorldAtlas): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: atlas.map,
    emissiveMap: atlas.emissive,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 0,
    roughnessMap: atlas.orm,
    metalnessMap: atlas.orm,
    roughness: 1,
    metalness: 1,
    vertexColors: true,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 cell;\nvarying vec4 vCell;\nvarying vec2 vTileUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCell = cell;\nvTileUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vCell;\nvarying vec2 vTileUv;')
      .replace(
        '#include <map_fragment>',
        `vec2 aT = clamp(fract(vTileUv), vec2(0.002), vec2(0.998));
         vec2 aUv = vCell.xy + aT * vCell.zw;
         vec2 aDx = dFdx(vTileUv) * vCell.zw;
         vec2 aDy = dFdy(vTileUv) * vCell.zw;
         vec4 sampledDiffuseColor = textureGrad(map, aUv, aDx, aDy);
         diffuseColor *= sampledDiffuseColor;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
         vec4 texelRoughness = textureGrad(roughnessMap, aUv, aDx, aDy);
         roughnessFactor *= texelRoughness.g;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `float metalnessFactor = metalness;
         vec4 texelMetalness = textureGrad(metalnessMap, aUv, aDx, aDy);
         metalnessFactor *= texelMetalness.b;`,
      )
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= textureGrad(emissiveMap, aUv, aDx, aDy).rgb;');
  };
  m.customProgramCacheKey = () => 'atlas-v1';
  return m;
}

export function createAsphaltMaterial(): THREE.MeshStandardMaterial {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const rng = new RNG(77);
  ctx.fillStyle = '#3a3a3b';
  ctx.fillRect(0, 0, S, S);
  noise(ctx, S, S, rng, 0.18, 90000, 1.6);
  // patches (repairs) and oil stains
  for (let i = 0; i < 14; i++) {
    const x = rng.next() * S, y = rng.next() * S, w = rng.range(40, 220), h = rng.range(30, 160);
    ctx.fillStyle = `rgba(${rng.next() < 0.5 ? '30,30,32' : '95,93,90'},${rng.range(0.12, 0.3)})`;
    ctx.fillRect(x, y, w, h);
  }
  for (let i = 0; i < 30; i++) {
    const x = rng.next() * S, y = rng.next() * S, r = rng.range(8, 50);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(15,15,15,0.35)');
    g.addColorStop(1, 'rgba(15,15,15,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // cracks
  ctx.strokeStyle = 'rgba(20,20,20,0.5)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 40; i++) {
    let x = rng.next() * S, y = rng.next() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += rng.range(-18, 18);
      y += rng.range(-18, 18);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // dust
  ctx.fillStyle = 'rgba(160,145,120,0.06)';
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, metalness: 0, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  // wet look: mirror reflection from WetReflection, strongest at grazing angles and in puddles
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wetUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; uniform sampler2D tReflect; uniform mat4 uTexMat; uniform float uWet; uniform float uTime;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <opaque_fragment>', `
        if (uWet > 0.01) {
          vec3 V = normalize(cameraPosition - vWPos);
          float F = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
          float puddle = smoothstep(0.30, 0.62, wNoise(vWPos.xz * 0.045) * 0.65 + wNoise(vWPos.xz * 0.19) * 0.35);
          vec4 rc = uTexMat * vec4(vWPos, 1.0);
          vec2 ripple = vec2(sin(vWPos.x * 2.7 + uTime * 1.6) + sin(vWPos.z * 4.1 - uTime * 2.1), cos(vWPos.z * 3.3 + uTime * 1.3) + cos(vWPos.x * 5.2 + uTime * 1.9)) * 0.0022;
          float grit = wNoise(vWPos.xz * 6.0) - 0.5;
          vec2 ruv = rc.xy / rc.w + ripple * (0.4 + 0.6 * puddle) + grit * 0.004 * (1.0 - puddle);
          float lod = mix(3.2, 0.6, puddle) * (1.0 - 0.5 * uWet);
          vec3 refl = textureLod(tReflect, clamp(ruv, 0.001, 0.999), lod).rgb;
          float k = uWet * (0.28 + 0.72 * F) * mix(0.45, 1.0, puddle);
          outgoingLight = mix(outgoingLight * (1.0 - 0.5 * uWet), refl, k);
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'asphalt-wet-v1';
  return m;
}

export function createMarkingMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
}

export function createWaterMaterial(): THREE.MeshStandardMaterial {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  // tileable normal map from summed sines
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2, v = (y / S) * Math.PI * 2;
      const dx = Math.cos(u * 3 + v) * 0.5 + Math.cos(u * 7 - v * 2) * 0.3 + Math.cos(u * 11 + v * 5) * 0.2;
      const dy = Math.cos(v * 4 + u) * 0.5 + Math.cos(v * 6 - u * 3) * 0.3 + Math.cos(v * 13 + u * 2) * 0.2;
      const i = (y * S + x) * 4;
      img.data[i] = 128 + dx * 60;
      img.data[i + 1] = 128 + dy * 60;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ color: 0x3d5a4e, roughness: 0.12, metalness: 0.15, normalMap: t, normalScale: new THREE.Vector2(0.35, 0.35) });
  return m;
}

export function createWireMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.85 });
}
