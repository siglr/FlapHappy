import {
  PROFILE_SCHEMA,
  type BallastConfig,
  type CurrentFlapConfig,
  type FlapPosition,
  type Profile,
  type Speed,
} from './types';
import { knotsToMs, msToKnots } from './units';

export function blankSpeed(): Speed {
  return { no_ballast_kt: null, max_ballast_kt: null };
}

export function defaultBallast(): BallastConfig {
  return {
    source: 'manual',
    default_fraction: 1,
    drag_snap: 0.05,
    max_ballast_litres: null,
    dump_minutes: 4,
    auto: { enabled: false },
  };
}

export function defaultCurrentFlap(): CurrentFlapConfig {
  return {
    source: 'index',
    lvar_name: null,
    manual_fallback: false,
  };
}

/** Visible profile title: the filename without `.json`. */
export function profileLabel(id: string): string {
  return sanitizeId(id) || 'profile';
}

/** The profile file name in the profile folder. */
export function profileFileName(id: string): string {
  return profileLabel(id) + '.json';
}

export function createBlankProfile(id = 'new-profile'): Profile {
  return {
    schema: PROFILE_SCHEMA,
    id,
    match: { title_contains: [] },
    units: 'kt',
    flaps: [],
    handle_count: null,
    vs_min: blankSpeed(),
    transitions: [],
    vne: null,
    weight_kg: { light: null, heavy: null },
    ballast: defaultBallast(),
    current_flap: defaultCurrentFlap(),
    marker_smoothing_ms: 300,
    bank_scaling: 'off',
    source: 'user',
    notes: '',
  };
}

export function cloneProfile(p: Profile): Profile {
  return JSON.parse(JSON.stringify(p)) as Profile;
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function isObj(x: unknown): x is Raw {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function numOrNull(x: unknown): number | null {
  return typeof x === 'number' && isFinite(x) ? x : null;
}

function strOr(x: unknown, d: string): string {
  return typeof x === 'string' ? x : d;
}

function numOr(x: unknown, d: number): number {
  return typeof x === 'number' && isFinite(x) ? x : d;
}

function fileSpeed(x: unknown): number | null {
  const n = numOrNull(x);
  return n === null ? null : msToKnots(n);
}

function normVne(r: Raw): number | null {
  return typeof r.vne_ms === 'number' && isFinite(r.vne_ms) ? msToKnots(r.vne_ms) : null;
}

function normSpeed(x: unknown): Speed {
  if (!isObj(x)) return blankSpeed();
  return { no_ballast_kt: fileSpeed(x.no_ballast_ms), max_ballast_kt: fileSpeed(x.max_ballast_ms) };
}

function normFlap(x: unknown): FlapPosition {
  const r = isObj(x) ? x : {};
  const hi = r.handle_index;
  return {
    label: strOr(r.label, ''),
    handle_index: typeof hi === 'number' && isFinite(hi) ? hi : null,
  };
}

export interface ParseResult {
  profile: Profile | null;
  errors: string[];
}

/**
 * Parse a profile from untrusted JSON. Fills defaults, drops `_help` style keys, and rejects files
 * whose `transitions` length is not max(N - 1, 0).
 */
export function normalizeProfile(input: unknown): ParseResult {
  if (!isObj(input)) return { profile: null, errors: ['Not a JSON object'] };
  if (input.schema !== PROFILE_SCHEMA) {
    return { profile: null, errors: [`Unsupported profile schema: ${String(input.schema)}`] };
  }
  const r = input;
  const errors: string[] = [];

  if (r.units !== 'ms') errors.push('Profile speeds must use units "ms"');
  const cfInEarly = isObj(r.current_flap) ? r.current_flap : {};
  const srcEarly = cfInEarly.source;
  if (srcEarly !== undefined && srcEarly !== 'index' && srcEarly !== 'percent' && srcEarly !== 'lvar') {
    errors.push(`Unsupported current_flap.source: ${String(srcEarly)}`);
  }
  if (!Array.isArray(r.flaps)) errors.push('"flaps" must be an array');
  const flaps = Array.isArray(r.flaps) ? r.flaps.map((row) => normFlap(row)) : [];
  const transIn = Array.isArray(r.transitions) ? r.transitions : [];
  const expected = Math.max(flaps.length - 1, 0);
  if (transIn.length !== expected) {
    errors.push(
      `"transitions" has ${transIn.length} entries but ${flaps.length} flap rows need ${expected}`,
    );
  }
  if (errors.length) return { profile: null, errors };

  const base = createBlankProfile();
  const weights = isObj(r.weight_kg) ? r.weight_kg : {};
  const ballastIn = isObj(r.ballast) ? r.ballast : {};
  const cfIn = isObj(r.current_flap) ? r.current_flap : {};
  const matchIn = isObj(r.match) ? r.match : {};
  const autoIn = isObj(ballastIn.auto) ? stripUnderscore(ballastIn.auto) : {};
  const src = cfIn.source;

  const profile: Profile = {
    schema: PROFILE_SCHEMA,
    id: sanitizeId(strOr(r.id, '')) || 'imported',
    match: {
      title_contains: Array.isArray(matchIn.title_contains)
        ? matchIn.title_contains.filter((s): s is string => typeof s === 'string')
        : [],
    },
    units: 'kt',
    flaps,
    handle_count: numOrNull(r.handle_count),
    vs_min: normSpeed(r.vs_min),
    transitions: transIn.map((row) => ({ ...normSpeed(row), ...(isObj(row) && row.exclude_from_display === true ? { exclude_from_display:true } : {}) })),
    vne: normVne(r),
    weight_kg: { light: numOrNull(weights.light), heavy: numOrNull(weights.heavy) },
    ballast: {
      ...base.ballast,
      default_fraction: clamp01(numOr(ballastIn.default_fraction, base.ballast.default_fraction)),
      drag_snap: numOr(ballastIn.drag_snap, base.ballast.drag_snap),
      max_ballast_litres: numOrNull(ballastIn.max_ballast_litres),
      dump_minutes: numOr(ballastIn.dump_minutes, base.ballast.dump_minutes),
      auto: { enabled: false, ...autoIn },
    },
    current_flap: {
      source: src === 'percent' || src === 'lvar' || src === 'index' ? src : 'index',
      lvar_name: typeof cfIn.lvar_name === 'string' && cfIn.lvar_name ? cfIn.lvar_name : null,
      manual_fallback: cfIn.manual_fallback === true,
    },
    marker_smoothing_ms: Math.max(0, numOr(r.marker_smoothing_ms, 300)),
    bank_scaling: 'off',
    source: r.source === 'preset' ? 'preset' : 'user',
    notes: strOr(r.notes, ''),
  };
  return { profile, errors: [] };
}

function stripUnderscore(o: Raw): Raw {
  const out: Raw = {};
  for (const k of Object.keys(o)) if (k.charAt(0) !== '_') out[k] = o[k];
  return out;
}

export function parseProfileJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { profile: null, errors: ['Not valid JSON: ' + (e instanceof Error ? e.message : String(e))] };
  }
  return normalizeProfile(raw);
}

function speedToFile(s: Speed): { no_ballast_ms: number | null; max_ballast_ms: number | null } {
  return {
    no_ballast_ms: s.no_ballast_kt === null ? null : knotsToMs(s.no_ballast_kt),
    max_ballast_ms: s.max_ballast_kt === null ? null : knotsToMs(s.max_ballast_kt),
  };
}

function flapToFile(f: FlapPosition): Raw {
  return { label: f.label, handle_index: f.handle_index };
}

/** Saved profile text. Speeds are metres per second. */
export function exportProfileJson(p: Profile): string {
  const file = {
    schema: p.schema,
    id: p.id,
    match: { title_contains: p.match.title_contains.slice() },
    units: 'ms',
    flaps: p.flaps.map(flapToFile),
    handle_count: p.handle_count,
    vs_min: speedToFile(p.vs_min),
    transitions: p.transitions.map(t => ({ ...speedToFile(t), ...(t.exclude_from_display === true ? { exclude_from_display:true } : {}) })),
    vne_ms: p.vne === null ? null : knotsToMs(p.vne),
    weight_kg: p.weight_kg,
    ballast: p.ballast,
    current_flap: p.current_flap,
    marker_smoothing_ms: p.marker_smoothing_ms,
    bank_scaling: p.bank_scaling,
    source: p.source,
    notes: p.notes,
  };
  return JSON.stringify(file, null, 2) + '\n';
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function sanitizeId(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
}

export function uniqueId(base: string, existing: string[]): string {
  const b = sanitizeId(base) || 'profile';
  if (existing.indexOf(b) < 0) return b;
  let n = 2;
  while (existing.indexOf(b + '-' + n) >= 0) n++;
  return b + '-' + n;
}

// ---------------------------------------------------------------------------
// Row / transition editing rules (always keep transitions.length === max(N - 1, 0))
// ---------------------------------------------------------------------------

export interface EditResult {
  profile: Profile;
  /** Index of a transition that was prefilled automatically (show amber until edited). */
  prefilled: number | null;
}

function mid(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.round(((a + b) / 2) * 10) / 10;
}

function midSpeed(lo: Speed, hi: Speed, loIsEnd: boolean, hiIsEnd: boolean): Speed {
  const loMax = loIsEnd && lo.max_ballast_kt === null ? lo.no_ballast_kt : lo.max_ballast_kt;
  const hiMax = hiIsEnd && hi.max_ballast_kt === null ? hi.no_ballast_kt : hi.max_ballast_kt;
  return { no_ballast_kt: mid(lo.no_ballast_kt, hi.no_ballast_kt), max_ballast_kt: mid(loMax, hiMax) };
}

export function nextFreeLabel(p: Profile): string {
  const used = p.flaps.map((r) => r.label);
  let n = p.flaps.length + 1;
  while (used.indexOf(String(n)) >= 0) n++;
  return String(n);
}

export function newRow(p: Profile, partial?: Partial<FlapPosition>): FlapPosition {
  return {
    label: partial?.label ?? nextFreeLabel(p),
    handle_index: partial && partial.handle_index !== undefined ? partial.handle_index : null,
  };
}

/**
 * Insert a row so that it ends up at index `pos` (0..N). Creates exactly one new transition
 * (none when the list was empty), prefilled with the midpoint of its two neighbouring boundaries.
 */
export function insertRowAt(p: Profile, pos: number, row?: FlapPosition): EditResult {
  const out = cloneProfile(p);
  const n = out.flaps.length;
  const at = Math.max(0, Math.min(n, pos));
  out.flaps.splice(at, 0, row ?? newRow(p));
  if (n === 0) return { profile: out, prefilled: null };
  const t = at < n ? at : n - 1;
  const lowerIsEnd = t === 0;
  const lower = lowerIsEnd ? out.vs_min : out.transitions[t - 1];
  const upperIsEnd = t >= out.transitions.length;
  const upper = upperIsEnd ? { no_ballast_kt: out.vne, max_ballast_kt: null } : out.transitions[t];
  const fresh = midSpeed(lower, upper, lowerIsEnd, upperIsEnd);
  out.transitions.splice(t, 0, fresh);
  return { profile: out, prefilled: t };
}

export function addRow(p: Profile, row?: FlapPosition): EditResult {
  // A downward sequence (5, 4, 3, 2, 1, 0) still grows at the top. The new index is left blank.
  const at = isStepDescending(p.flaps) ? 0 : p.flaps.length;
  return insertRowAt(p, at, row);
}

export function insertRowAfter(p: Profile, i: number, row?: FlapPosition): EditResult {
  return insertRowAt(p, i + 1, row);
}

export function insertRowBefore(p: Profile, i: number, row?: FlapPosition): EditResult {
  return insertRowAt(p, i, row);
}

/** Delete row i. Removes the transition on its slower side (or the one above, for the first row). */
export function deleteRow(p: Profile, i: number): Profile {
  if (i < 0 || i >= p.flaps.length) return p;
  const out = cloneProfile(p);
  out.flaps.splice(i, 1);
  if (out.transitions.length > 0) out.transitions.splice(i === 0 ? 0 : i - 1, 1);
  return out;
}

function isStepDescending(flaps: FlapPosition[]): boolean {
  if (flaps.length < 2) return false;
  for (let i = 1; i < flaps.length; i++) {
    const a = flaps[i - 1].handle_index;
    const b = flaps[i].handle_index;
    if (a === null || b === null || b !== a - 1) return false;
  }
  return true;
}

/** Move the label at `from` into slot `to`, shifting the labels between. Sim indexes and transitions stay put. */
export function moveLabel(p: Profile, from: number, to: number): Profile {
  const n = p.flaps.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return p;
  const out = cloneProfile(p);
  const labels = out.flaps.map((f) => f.label);
  const moved = labels.splice(from, 1)[0];
  labels.splice(to, 0, moved);
  out.flaps.forEach((f, i) => {
    f.label = labels[i];
  });
  return out;
}

export function setTransition(p: Profile, t: number, end: keyof Speed, value: number | null): Profile {
  if (t < 0 || t >= p.transitions.length) return p;
  const out = cloneProfile(p);
  out.transitions[t][end] = value;
  return out;
}

/** Label for the boundary between rows (used as `A -> B` in the editor). */
export function transitionName(p: Profile, t: number): string {
  const a = p.flaps[t]?.label ?? '?';
  const b = p.flaps[t + 1]?.label ?? '?';
  return `${a} -> ${b}`;
}

/** Plausibility helper: prefill max-ballast speeds from no-ballast with sqrt(m_max / m_no). */
export function prefillMaxBallast(p: Profile, massNoKg: number, massMaxKg: number): Profile {
  const k = Math.sqrt(massMaxKg / massNoKg);
  const out = cloneProfile(p);
  const fill = (s: Speed) => {
    if (s.no_ballast_kt !== null) s.max_ballast_kt = Math.round(s.no_ballast_kt * k * 10) / 10;
  };
  fill(out.vs_min);
  out.transitions.forEach(fill);
  return out;
}

/** Matching title strings are case-insensitive substrings. */
export function profileMatchesTitle(match: string[], title: string | null): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return match.some((m) => m.length > 0 && t.indexOf(m.toLowerCase()) >= 0);
}
