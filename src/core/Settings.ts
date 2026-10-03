// Persistent user settings (localStorage, guarded: private windows may throw).
import type { QualityName } from '../render/Quality';

export type SceneName = 'dawn' | 'day' | 'afternoon' | 'evening' | 'night';
export const SCENE_HOURS: Record<SceneName, number> = { dawn: 6.95, day: 12.5, afternoon: 16.2, evening: 18.65, night: 22 };

export interface Settings {
  quality: QualityName;
  scene: SceneName; // fixed time of day (no cycle)
  rain: boolean;
  police: boolean;
  smog: number; // 0.3 – 2
  traffic: number; // density multiplier 0 – 1.5
  masterVolume: number;
  engineVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  units: 'kmh' | 'mph';
  showFps: boolean;
  assists: boolean;
  invertCameraX: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'medium',
  scene: 'evening',
  rain: false,
  police: false,
  smog: 1,
  traffic: 1,
  masterVolume: 0.8,
  engineVolume: 0.8,
  sfxVolume: 0.8,
  ambientVolume: 0.6,
  units: 'kmh',
  showFps: false,
  assists: true,
  invertCameraX: false,
};

const KEY = 'gulberg-drive.settings.v3';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
