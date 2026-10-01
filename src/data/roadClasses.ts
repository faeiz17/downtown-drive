import type { RoadClass } from './types';

export interface RoadClassInfo {
  laneWidth: number;
  lanesTwoWay: number; // default total lanes for a two-way way
  lanesOneWay: number;
  sidewalk: number; // sidewalk width each side
  speed: number; // km/h
  rank: number; // hierarchy for rendering / minimap / traffic weighting
}

export const ROAD_CLASSES: Record<RoadClass, RoadClassInfo> = {
  trunk: { laneWidth: 3.5, lanesTwoWay: 4, lanesOneWay: 3, sidewalk: 3.0, speed: 70, rank: 6 },
  primary: { laneWidth: 3.4, lanesTwoWay: 4, lanesOneWay: 3, sidewalk: 3.0, speed: 60, rank: 5 },
  secondary: { laneWidth: 3.3, lanesTwoWay: 4, lanesOneWay: 2, sidewalk: 3.0, speed: 55, rank: 4 },
  tertiary: { laneWidth: 3.2, lanesTwoWay: 2, lanesOneWay: 2, sidewalk: 2.5, speed: 50, rank: 3 },
  link: { laneWidth: 3.3, lanesTwoWay: 2, lanesOneWay: 1, sidewalk: 0, speed: 40, rank: 2 },
  residential: { laneWidth: 3.0, lanesTwoWay: 2, lanesOneWay: 1, sidewalk: 0, speed: 30, rank: 1 },
  service: { laneWidth: 2.4, lanesTwoWay: 2, lanesOneWay: 1, sidewalk: 0, speed: 20, rank: 0 },
};

export function classifyHighway(hw: string): RoadClass | null {
  switch (hw) {
    case 'motorway':
    case 'trunk':
      return 'trunk';
    case 'primary':
      return 'primary';
    case 'secondary':
      return 'secondary';
    case 'tertiary':
      return 'tertiary';
    case 'motorway_link':
    case 'trunk_link':
    case 'primary_link':
    case 'secondary_link':
    case 'tertiary_link':
      return 'link';
    case 'residential':
    case 'unclassified':
    case 'living_street':
    case 'road':
      return 'residential';
    case 'service':
      return 'service';
    default:
      return null;
  }
}

export const isMajor = (c: RoadClass) => c === 'trunk' || c === 'primary' || c === 'secondary' || c === 'tertiary';
