import type { Profile, Speed } from './types';
import { clamp01 } from './profile';

/** x(f) = no_ballast + f * (max_ballast - no_ballast); a missing max means "same as no ballast". */
export function effectiveSpeed(s: Speed, f: number): number | null {
  if (s.no_ballast_kt === null) return null;
  const mx = s.max_ballast_kt === null ? s.no_ballast_kt : s.max_ballast_kt;
  return s.no_ballast_kt + clamp01(f) * (mx - s.no_ballast_kt);
}

/**
 * Boundary speeds `[Vs, T1..T(N-1), Vne]` (length N + 1) at ballast fraction f, or null when any
 * value is missing or the sequence is not strictly ascending. N = 0 gives `[Vs, Vne]` when both are set.
 */
export function effectiveBoundaries(p: Profile, f: number): number[] | null {
  const n = p.flaps.length;
  if (p.transitions.length !== Math.max(n - 1, 0)) return null;
  const specs: Speed[] = [p.vs_min];
  for (let k = 0; k < n - 1; k++) if (!p.transitions[k].exclude_from_display) specs.push(p.transitions[k]);
  specs.push({ no_ballast_kt: p.vne, max_ballast_kt: null });
  const out: number[] = [];
  for (const s of specs) {
    const v = effectiveSpeed(s, f);
    if (v === null || !isFinite(v)) return null;
    out.push(v);
  }
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) return null;
  return out;
}

/** Consecutive physical flap rows share a display band when their separating
 * transition is excluded. The simulator mapping is never changed. */
export function flapGroups(p:Profile): { labels:string[]; members:number[][] } {
  const members:number[][]=[];
  p.flaps.forEach((_row,i)=>{
    if(i===0||!p.transitions[i-1]?.exclude_from_display)members.push([]);
    members[members.length-1].push(i);
  });
  return {members,labels:members.map(group=>group.map(i=>p.flaps[i].label).join('-'))};
}

/** Number of bar columns: one per flap, or a single unsegmented column for N = 0. */
export function columnCount(n: number): number {
  return Math.max(n, 1);
}

/** Column edges as fractions of the bar width `[0 .. 1]`, length columns + 1. The bar is linear in speed. */
export function columnEdges(boundaries: number[]): number[] {
  const cols = boundaries.length - 1;
  if (cols <= 0) return [0, 1];
  const lo = boundaries[0];
  const total = boundaries[cols] - lo;
  const edges: number[] = [0];
  for (let i = 1; i < cols; i++) edges.push((boundaries[i] - lo) / total);
  edges.push(1);
  return edges;
}

export type MarkerRegion = 'below' | 'in' | 'above';

export interface MarkerPos {
  /** 0..1 along the bar (pinned to the ends when off-scale). */
  pos: number;
  region: MarkerRegion;
  /** Column containing the IAS (bucket i = flap i), or -1 when off-scale. */
  column: number;
}

/** Index of the bucket `[b[i], b[i+1])` containing the speed, or -1 when below or above the bar. */
export function bucketIndex(ias: number, boundaries: number[]): number {
  const cols = boundaries.length - 1;
  if (ias < boundaries[0] || ias > boundaries[cols]) return -1;
  for (let i = 0; i < cols; i++) {
    if (ias < boundaries[i + 1]) return i;
  }
  return cols - 1;
}

/** Piecewise-linear marker mapping: inside column i, linear between its two edges. */
export function mapMarker(ias: number, boundaries: number[], edges: number[]): MarkerPos {
  const cols = boundaries.length - 1;
  if (ias < boundaries[0]) return { pos: 0, region: 'below', column: -1 };
  if (ias > boundaries[cols]) return { pos: 1, region: 'above', column: -1 };
  const i = bucketIndex(ias, boundaries);
  const lo = boundaries[i];
  const hi = boundaries[i + 1];
  const frac = hi > lo ? (ias - lo) / (hi - lo) : 0;
  return { pos: edges[i] + frac * (edges[i + 1] - edges[i]), region: 'in', column: i };
}

export function tickLabels(boundaries: number[]): string[] {
  return boundaries.map((b) => String(Math.round(b)));
}

/** Native panel width in px: max(560, N * 64 + margins); 64 px per column keeps cells at 56 px with 8 px gaps. */
export function nativeWidth(n: number): number {
  const GUTTERS = 96 + 128 + 32;
  return Math.max(560, n * 64 + GUTTERS);
}

/** Exponential smoothing step; tauMs <= 0 disables smoothing. */
export function smoothStep(prev: number | null, next: number, dtMs: number, tauMs: number): number {
  if (prev === null || tauMs <= 0 || dtMs <= 0) return next;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return prev + (next - prev) * alpha;
}
