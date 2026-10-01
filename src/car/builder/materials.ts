// PBR material definitions for the Lancer (written to glTF by scripts/build-car.ts).
import { SPEC } from '../spec';

export interface MatDef {
  color: number; // sRGB hex
  alpha?: number;
  metallic: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  emissive?: number; // sRGB hex
  emissiveStrength?: number;
  ior?: number;
  doubleSided?: boolean;
}

export const MATERIALS: Record<string, MatDef> = {
  // the base mesh has single-sided shells in places; paint is double-sided so no gaps show from odd angles
  Paint: { color: SPEC.paint, metallic: 0.45, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.035, doubleSided: true },
  Underbody: { color: 0x151515, metallic: 0, roughness: 0.95 },
  BlackPlastic: { color: 0x101011, metallic: 0, roughness: 0.6, doubleSided: true },
  BlackGloss: { color: 0x060606, metallic: 0, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 },
  Chrome: { color: 0xe6e6e6, metallic: 1, roughness: 0.08 },
  Seam: { color: 0x050505, metallic: 0, roughness: 1 },
  GlassClear: { color: 0x0a1014, alpha: 0.22, metallic: 0, roughness: 0.02, ior: 1.5 },
  GlassTint: { color: 0x05080a, alpha: 0.5, metallic: 0, roughness: 0.02, ior: 1.5 },
  GlassDark: { color: 0x030405, alpha: 0.88, metallic: 0, roughness: 0.03, ior: 1.5 },
  LensClear: { color: 0xf0f4f8, alpha: 0.14, metallic: 0, roughness: 0.02, ior: 1.5 },
  Reflector: { color: 0xd8dadd, metallic: 1, roughness: 0.14, doubleSided: true },
  Light_Head: { color: 0x8c9196, metallic: 0.6, roughness: 0.15, emissive: 0xfff4de, emissiveStrength: 0 },
  Light_Tail: { color: 0x7a0806, metallic: 0.1, roughness: 0.25, emissive: 0xff1a0c, emissiveStrength: 0 },
  Light_Brake: { color: 0x8c0a08, metallic: 0.1, roughness: 0.22, emissive: 0xff1208, emissiveStrength: 0 },
  Light_Reverse: { color: 0xe8e8e8, metallic: 0, roughness: 0.2, emissive: 0xffffff, emissiveStrength: 0 },
  Light_Indicator: { color: 0xc86a00, metallic: 0, roughness: 0.25, emissive: 0xff8a00, emissiveStrength: 0 },
  Rubber: { color: 0x141414, metallic: 0, roughness: 0.9 },
  Rim: { color: 0x19191a, metallic: 0.55, roughness: 0.42 },
  BrakeDisc: { color: 0x6f6f6f, metallic: 0.9, roughness: 0.35 },
  Caliper: { color: 0x2b2b2d, metallic: 0.3, roughness: 0.5 },
  Leather: { color: 0xcdb99a, metallic: 0, roughness: 0.62, doubleSided: true },
  InteriorDark: { color: 0x2a2a2a, metallic: 0, roughness: 0.8, doubleSided: true },
  InteriorTrim: { color: 0xcfc2a8, metallic: 0, roughness: 0.75, doubleSided: true },
  Headliner: { color: 0xddd3c0, metallic: 0, roughness: 0.9, doubleSided: true },
  Carpet: { color: 0x3a332a, metallic: 0, roughness: 1, doubleSided: true },
  SteeringWheel: { color: 0xc4ad88, metallic: 0, roughness: 0.55, doubleSided: true },
  Gauge: { color: 0x0c0c0c, metallic: 0, roughness: 0.3, emissive: 0xffffff, emissiveStrength: 0, doubleSided: true },
  GaugeMarks: { color: 0xe8e8e8, metallic: 0, roughness: 0.4, emissive: 0xffe6c0, emissiveStrength: 0, doubleSided: true },
  Plate: { color: 0xffffff, metallic: 0, roughness: 0.4 },
  Badge: { color: 0xffffff, alpha: 0.999, metallic: 0.8, roughness: 0.2 },
  TireLettering: { color: 0xffffff, alpha: 0.999, metallic: 0, roughness: 0.7 },
  Visor: { color: 0x0d1114, alpha: 0.78, metallic: 0, roughness: 0.1 },
  Mirror: { color: 0xc0c6cc, metallic: 1, roughness: 0.02 },
};
