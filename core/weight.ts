import type { Profile } from './types';
import type { SimSample } from './sim';
import { clamp01 } from './profile';

export type WeightMode = 'manual' | 'live';

export interface WeightState {
  kg: number | null;
  fraction: number | null;
  anchorsValid: boolean;
}

export function validWeightAnchors(p: Profile | null): boolean {
  const light = p?.weight_kg?.light;
  const heavy = p?.weight_kg?.heavy;
  return typeof light === 'number' && isFinite(light) && light > 0 &&
    typeof heavy === 'number' && isFinite(heavy) && heavy > light;
}

/** A missing anchor opts into legacy manual behavior. A malformed complete pair
 * is a validation error, not a reason to silently switch control modes. */
export function usesManualBallast(p: Profile | null): boolean {
  return !!p && (p.wsg?.ballastMode==='manual' || p.weight_kg?.light == null || p.weight_kg?.heavy == null);
}

/** Infer the stored mode from anchors, including old files without this object. */
export function weightModeForProfile(p: Profile | null): WeightMode {
  return p && !usesManualBallast(p) ? 'live' : 'manual';
}

/** Explicitly selected live mode cannot be saved with incomplete or invalid anchors. */
export function canSaveWeightMode(p: Profile | null, mode: WeightMode): boolean {
  return !!p && (mode === 'manual' || validWeightAnchors(p));
}

/** Manual is represented by absent anchors, not an extra profile-format field. */
export function profileForWeightMode(p: Profile, mode: WeightMode): Profile {
  if (mode === 'manual' && !usesManualBallast(p)) return { ...p, weight_kg: { light: null, heavy: null } };
  return p;
}

/** Clamp the interpolation only; keep the actual flying weight unchanged for display. */
export function liveWeight(p: Profile | null, sample: SimSample | null, live: boolean): WeightState {
  const raw = sample?.totalWeightKg;
  const kg = live && typeof raw === 'number' && isFinite(raw) && raw > 0 ? raw : null;
  const anchorsValid = validWeightAnchors(p);
  let fraction: number | null = null;
  if (kg !== null && p && anchorsValid) {
    const light = p.weight_kg.light as number;
    const heavy = p.weight_kg.heavy as number;
    fraction = Math.max(0, Math.min(1, (kg - light) / (heavy - light)));
  }
  return { kg, fraction, anchorsValid };
}

/** Only profiles without a complete weight pair use the saved manual fraction.
 * Anchored profiles never use ballast as a substitute for missing live telemetry. */
export function interpolationFraction(p: Profile | null, state: WeightState, manual?: number): number | null {
  if (!p) return null;
  if (state.anchorsValid && !usesManualBallast(p)) return state.fraction;
  if (!usesManualBallast(p)) return null;
  return clamp01(typeof manual === 'number' && isFinite(manual) ? manual : p.ballast.default_fraction);
}
