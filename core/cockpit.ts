import type { Profile } from './types';
import type { SimSample } from './sim';

/** Live display state published by the main process for the shared in-sim and external display. */
export interface CockpitState {
  ready: boolean;
  profile: Profile | null;
  /** Current live aircraft has no selected profile; keep cockpit and desktop consistent. */
  noProfileMessage?: string;
  profileSource?: 'manual'|'assigned'|'local'|'fallback'|'wsg'|'none';
  aircraftTitle?:string|null;
  aircraftBindingKey?:string|null;
  detectedWsgVariant?:string|null;
  sample: SimSample | null;
  /** When the session last received `sample`, in ms. */
  receivedAt: number;
  /** Manual ballast fraction (ignored for profiles with valid loaded-weight anchors). */
  ballast: number;
  units: 'kt' | 'kmh';
  height: 'ft' | 'm';
  /** AGL bar ends and the green band, in feet. */
  agl: { bottom_m: number; top_m: number; low_m: number; high_m: number };
  zoom: number;
  showBallast: boolean;
  showAgl: boolean;
  showTransitions: boolean;
  showWind: boolean;
  /** Cylinder shading on the IAS and AGL fills. Missing means on. */
  barShading: boolean;
}

export const COCKPIT_PORT = 47321;
