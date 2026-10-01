declare module 'n8ao' {
  import { Pass } from 'postprocessing';
  import type * as THREE from 'three';
  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    camera: THREE.Camera;
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      halfRes: boolean;
      gammaCorrection: boolean;
      color: THREE.Color;
      screenSpaceRadius: boolean;
      depthAwareUpsampling: boolean;
      transparencyAware: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
  }
}
