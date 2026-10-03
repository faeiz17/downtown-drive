// Graphics quality presets (Low / Medium / High), sized from GPU profiling at MacBook Retina 2× (scripts/debug/gpucost.ts).
// Budget rules applied (three-best-practices): ≤ 3 dynamic lights on top of sun + sky, SSAO at half resolution,
// shadow maps ≤ 2048 with a tight camera, pixel ratio capped (and further scaled at runtime by DynamicResolution).
export type QualityName = 'low' | 'medium' | 'high';

export interface QualityPreset {
  name: QualityName;
  pixelRatio: number; // max render pixel ratio (CSS px → device px); DynamicResolution may go lower
  minPixelRatio: number; // floor for dynamic resolution
  shadows: boolean;
  shadowMapSize: number; // per cascade (3 cascades)
  shadowRange: number; // how far from the camera shadows reach (m)
  ssao: boolean;
  ssaoMode: 'Performance' | 'Low' | 'Medium';
  bloom: boolean;
  motionBlur: boolean;
  smaa: boolean; // fallback AA, only used when taa is off
  taa: boolean; // temporal anti-aliasing with reprojection (src/render/TAAPass.ts)
  drawDistance: number;
  propNear: number;
  propFar: number;
  traffic: number;
  pointLights: number; // real point lights following the nearest street lamps at night
  headlightShadows: boolean;
  reflections: boolean; // planar wet-road reflections
}

export const QUALITY: Record<QualityName, QualityPreset> = {
  low: {
    name: 'low', pixelRatio: 1, minPixelRatio: 0.6, shadows: false, shadowMapSize: 1024, shadowRange: 60, ssao: false, ssaoMode: 'Performance', bloom: true, motionBlur: false, smaa: false, taa: false,
    drawDistance: 480, propNear: 90, propFar: 280, traffic: 20, pointLights: 0, headlightShadows: false, reflections: false,
  },
  medium: {
    name: 'medium', pixelRatio: 1, minPixelRatio: 0.7, shadows: true, shadowMapSize: 1024, shadowRange: 130, ssao: true, ssaoMode: 'Performance', bloom: true, motionBlur: true, smaa: false, taa: true,
    drawDistance: 800, propNear: 140, propFar: 460, traffic: 45, pointLights: 0, headlightShadows: false, reflections: true,
  },
  high: {
    name: 'high', pixelRatio: 1.15, minPixelRatio: 0.85, shadows: true, shadowMapSize: 1536, shadowRange: 200, ssao: true, ssaoMode: 'Performance', bloom: true, motionBlur: true, smaa: true, taa: true,
    drawDistance: 1200, propNear: 160, propFar: 600, traffic: 70, pointLights: 3, headlightShadows: false, reflections: true,
  },
};
