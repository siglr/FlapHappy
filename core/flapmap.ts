import type { CurrentFlapSource, Profile } from './types';
import type { SimSample } from './sim';

export type FlapStatus =
  /** Live flap matches a bar row: `rowIndex` is the highlighted cell. */
  | 'row'
  /** Lever index is valid but not in the profile: shown as `#<index>`. */
  | 'unlisted'
  /** Nothing readable: amber `FLAP ?`. */
  | 'unknown'
  | 'noflaps';

export type FlapVia = 'index' | 'percent' | 'lvar' | 'manual';

export interface CurrentFlap {
  status: FlapStatus;
  rowIndex: number | null;
  /** Row label, or `#<index>` when the lever is not on a row. */
  label: string | null;
  handleIndex: number | null;
  via: FlapVia | null;
}

function isValidIndex(idx: number | null, count: number | null): idx is number {
  if (idx === null || !isFinite(idx)) return false;
  if (idx < 0 || Math.abs(idx - Math.round(idx)) > 1e-6) return false;
  if (count !== null && count > 0 && idx >= count) return false;
  if (count === 0) return false;
  return true;
}

function lookupIndex(p: Profile, idx: number): CurrentFlap | null {
  const row = p.flaps.findIndex((r) => r.handle_index === idx);
  if (row >= 0) return { status: 'row', rowIndex: row, label: p.flaps[row].label, handleIndex: idx, via: null };
  return { status: 'unlisted', rowIndex: null, label: '#' + idx, handleIndex: idx, via: null };
}

const CANONICAL: CurrentFlapSource[] = ['index', 'percent', 'lvar'];

/**
 * Resolves the current flap from a sample. Fallback chain (first applicable wins), starting from the
 * profile's `current_flap.source`:
 *   index (in range) -> percent (even spacing) -> named L: var -> unknown.
 * Never returns more than one highlighted row.
 */
export class CurrentFlapResolver {
  private manual: number | null = null;

  reset(): void {
    // Manual selection is kept across samples; there is no other resolver memory.
  }

  /** Optional manual mode: the pilot taps a cell to declare the current flap. */
  setManual(rowIndex: number | null): void {
    this.manual = rowIndex;
  }

  resolve(p: Profile, s: SimSample | null, _nowMs: number): CurrentFlap {
    if (p.flaps.length === 0) {
      return { status: 'noflaps', rowIndex: null, label: null, handleIndex: null, via: null };
    }
    const unknown: CurrentFlap = { status: 'unknown', rowIndex: null, label: null, handleIndex: null, via: null };
    if (!s || !s.connected) return unknown;
    if(p.wsg){
      if(s.flapCount!==p.handle_count||!isValidIndex(s.flapIndex,s.flapCount))return unknown;
      const exact=lookupIndex(p,s.flapIndex);return exact?{...exact,via:'index'}:unknown;
    }
    const order = [p.current_flap.source].concat(CANONICAL.filter((x) => x !== p.current_flap.source));
    const count = s.flapCount;
    let result: CurrentFlap | null = null;

    for (const src of order) {
      if (src === 'index') {
        if (isValidIndex(s.flapIndex, count)) {
          result = lookupIndex(p, s.flapIndex);
          if (result) result.via = 'index';
        }
      } else if (src === 'percent') {
        if (s.flapPercent !== null && isFinite(s.flapPercent) && count !== null && count > 1) {
          const idx = Math.round(Math.max(0, Math.min(1, s.flapPercent)) * (count - 1));
          result = lookupIndex(p, idx);
          if (result) result.via = 'percent';
        }
      } else if (src === 'lvar') {
        if (p.current_flap.lvar_name && s.lvar !== null && isFinite(s.lvar)) {
          const idx = Math.round(s.lvar);
          if (idx >= 0) {
            result = lookupIndex(p, idx);
            if (result) result.via = 'lvar';
          }
        }
      }
      if (result) break;
    }

    if (!result && p.current_flap.manual_fallback && this.manual !== null && this.manual < p.flaps.length) {
      const row = p.flaps[this.manual];
      result = { status: 'row', rowIndex: this.manual, label: row.label, handleIndex: row.handle_index, via: 'manual' };
    }
    return result ?? unknown;
  }
}
