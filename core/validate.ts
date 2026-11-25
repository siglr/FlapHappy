import { validateWsgFlight } from './wsg-flight';
import type { FlapPosition, Issue, IssueCategory, Profile, ValidationResult } from './types';

export interface ValidateOptions {
  /** Live `FLAPS NUM HANDLE POSITIONS` when the sim is connected. */
  liveHandleCount?: number | null;
  /** The editor explicitly selected live weight; both anchors are then required. */
  requireWeightAnchors?: boolean;
}

export const MIN_BUCKET_ERROR_KT = 2;
export const MIN_BUCKET_WARN_KT = 4;
export const MAX_LABEL_CHARS = 6;
export const RECOMMENDED_LABEL_CHARS = 4;
export const SOFT_MAX_ROWS = 10;

function isNum(x: unknown): x is number {
  return typeof x === 'number' && isFinite(x);
}

export interface Boundaries {
  names: string[];
  no: Array<number | null>;
  max: Array<number | null>;
  /** Paths for the No Ballast / Max Ballast fields of each boundary. */
  paths: Array<{ no: string; max: string }>;
}

/** Boundary vectors `[Vs, T1..T(N-1), Vne]` with the "blank max means same" rule applied. */
export function boundaryVectors(p: Profile): Boundaries {
  const n = p.flaps.length;
  const names = ['Min (stall)'];
  const no: Array<number | null> = [p.vs_min.no_ballast_kt];
  const max: Array<number | null> = [p.vs_min.max_ballast_kt ?? p.vs_min.no_ballast_kt];
  const paths = [{ no: 'vs_min.no_ballast_kt', max: 'vs_min.max_ballast_kt' }];
  for (let k = 0; k < n - 1; k++) {
    const t = p.transitions[k];
    if(t?.exclude_from_display)continue;
    names.push('T' + (k + 1));
    no.push(t ? t.no_ballast_kt : null);
    max.push(t ? t.max_ballast_kt : null);
    paths.push({ no: `transitions[${k}].no_ballast_kt`, max: `transitions[${k}].max_ballast_kt` });
  }
  names.push('Max (Vne)');
  no.push(p.vne);
  max.push(p.vne);
  paths.push({ no: 'vne', max: 'vne' });
  return { names, no, max, paths };
}

export function validateProfile(p: Profile, opts: ValidateOptions = {}): ValidationResult {
  if(p.wsg)return validateWsgFlight(p,opts.liveHandleCount);
  const issues: Issue[] = [];
  const add = (
    level: 'error' | 'warning',
    category: IssueCategory,
    code: string,
    message: string,
    path?: string,
  ) => issues.push({ level, category, code, message, path });

  const n = p.flaps.length;

  // --- Structure ---
  if (p.transitions.length !== Math.max(n - 1, 0)) {
    add('error', 'structure', 'transitions-length', `Expected ${Math.max(n - 1, 0)} transitions for ${n} flap rows, found ${p.transitions.length}`);
  }
  const seenLabels: string[] = [];
  const allRows: Array<{ row: FlapPosition; path: string; isBar: boolean }> = [];
  p.flaps.forEach((row, i) => allRows.push({ row, path: `flaps[${i}]`, isBar: true }));

  for (const { row, path } of allRows) {
    const label = row.label.trim();
    if (!label) {
      add('error', 'structure', 'label-empty', 'Every flap needs a label', path + '.label');
    } else {
      if (seenLabels.indexOf(label) >= 0) {
        add('error', 'structure', 'label-duplicate', `Label "${label}" is used more than once`, path + '.label');
      }
      seenLabels.push(label);
      if (label.length > MAX_LABEL_CHARS) {
        add('error', 'structure', 'label-long', `Label "${label}" is longer than ${MAX_LABEL_CHARS} characters`, path + '.label');
      } else if (label.length > RECOMMENDED_LABEL_CHARS) {
        add('warning', 'structure', 'label-long-warn', `Label "${label}" is longer than ${RECOMMENDED_LABEL_CHARS} characters and will be shown smaller`, path + '.label');
      }
    }
    if (row.handle_index === null || !Number.isInteger(row.handle_index) || row.handle_index < 0) {
      add('error', 'structure', 'index-invalid', `Flap "${label || '?'}" needs a handle index (whole number, 0 or more)`, path + '.handle_index');
    }
  }
  const seenIdx: number[] = [];
  for (const { row, path } of allRows) {
    if (row.handle_index === null || !Number.isInteger(row.handle_index)) continue;
    if (seenIdx.indexOf(row.handle_index) >= 0) {
      add('error', 'structure', 'index-duplicate', `Handle index ${row.handle_index} is used more than once`, path + '.handle_index');
    }
    seenIdx.push(row.handle_index);
  }
  const count = opts.liveHandleCount ?? p.handle_count;
  if (count !== null && count !== undefined && count > 0) {
    for (const { row, path } of allRows) {
      if (row.handle_index !== null && row.handle_index >= count) {
        const where = isNum(opts.liveHandleCount) ? 'the sim reports' : 'this profile expects';
        add('warning', 'structure', 'index-range', `Handle index ${row.handle_index} is outside 0..${count - 1} (${where} ${count} positions)`, path + '.handle_index');
      }
    }
  }

  // Missing either endpoint is a supported manual-ballast profile. Supplied
  // values must be valid; a complete pair must be ordered.
  const weights = p.weight_kg;
  if (opts.requireWeightAnchors) {
    if (weights?.light == null) add('error', 'other', 'weight-light-required', 'Enter Light flying weight for live weight mode', 'weight_kg.light');
    if (weights?.heavy == null) add('error', 'other', 'weight-heavy-required', 'Enter Heavy flying weight for live weight mode', 'weight_kg.heavy');
  }
  if (weights) {
    if (weights.light !== null && (!isNum(weights.light) || weights.light <= 0)) add('error', 'other', 'weight-light', 'Light flying weight must be positive', 'weight_kg.light');
    if (weights.heavy !== null && (!isNum(weights.heavy) || weights.heavy <= 0 || (isNum(weights.light) && weights.heavy <= weights.light))) add('error', 'other', 'weight-heavy', 'Heavy flying weight must exceed Light', 'weight_kg.heavy');
  }

  // --- Required numbers ---
  const b = boundaryVectors(p);
  const barNeeded = n >= 1;
  const checkBar = barNeeded || (isNum(p.vs_min.no_ballast_kt) && isNum(p.vne));
  if (barNeeded) {
    b.names.forEach((name, i) => {
      const isVne = i === b.names.length - 1;
      if (isVne) {
        if (!isNum(b.no[i]) || (b.no[i] as number) <= 0) {
          add('error', 'speeds', 'speed-missing', `${name} speed is required`, 'vne');
        }
        return;
      }
      const isEnd = i === 0;
      if(isEnd&&p.vs_min.no_ballast_kt===null&&p.vs_min.max_ballast_kt===null)return;
      const transitionIndex=Number(/^transitions\[(\d+)\]/.exec(b.paths[i].no)?.[1]);
      const label = isEnd ? name : `${name} (${p.flaps[transitionIndex]?.label ?? '?'} -> ${p.flaps[transitionIndex+1]?.label ?? '?'})`;
      const noOk = isNum(b.no[i]) && (b.no[i] as number) > 0;
      const maxOk = isNum(b.max[i]) && (b.max[i] as number) > 0;
      if (!noOk) add('error', 'speeds', 'speed-missing', `${label}: No Ballast speed is required`, b.paths[i].no);
      if (!maxOk && (noOk || !isEnd)) {
        add('error', 'speeds', 'speed-missing', `${label}: Max Ballast speed is required`, b.paths[i].max);
      }
    });
  }

  // --- Ascending, strictly, separately for both ends ---
  if (checkBar) {
    const ends: Array<{ key: 'no' | 'max'; label: string }> = [
      { key: 'no', label: 'No Ballast' },
      { key: 'max', label: 'Max Ballast' },
    ];
    for (const end of ends) {
      const v = b[end.key];
      for (let i = 1; i < v.length; i++) {
        const cur = v[i];
        const prev = v[i - 1];
        if (!isNum(cur) || !isNum(prev)) continue;
        const curName = i === v.length - 1 ? b.names[i] : `${b.names[i]} (${end.label})`;
        const prevName = `${b.names[i - 1]} (${end.label})`;
        if (cur <= prev) {
          add(
            'error',
            'speeds',
            'not-ascending',
            `${curName} ${cur} must be above ${prevName} ${prev}`,
            b.paths[i][end.key],
          );
        } else if (n >= 1 && cur - prev < MIN_BUCKET_ERROR_KT) {
          add(
            'error',
            'speeds',
            'bucket-too-narrow',
            `${curName} ${cur} is less than ${MIN_BUCKET_ERROR_KT} kt above ${prevName} ${prev}`,
            b.paths[i][end.key],
          );
        } else if (n >= 1 && cur - prev < MIN_BUCKET_WARN_KT) {
          add(
            'warning',
            'speeds',
            'bucket-narrow',
            `${curName} ${cur} is only ${Math.round((cur - prev) * 10) / 10} kt above ${prevName} ${prev}`,
            b.paths[i][end.key],
          );
        }
      }
    }
  }

  // --- Direction hints ---
  if (barNeeded) {
    const dirCheck = (i: number) => {
      const no = b.no[i];
      const mx = b.max[i];
      if (isNum(no) && isNum(mx) && mx < no) {
        add('warning', 'speeds', 'ballast-direction', `${b.names[i]}: Max Ballast ${mx} is below No Ballast ${no} (heavier normally means higher speeds)`, b.paths[i].max);
      }
    };
    for (let i = 0; i < b.names.length - 1; i++) dirCheck(i);
  }
  if (n > SOFT_MAX_ROWS) add('warning', 'other', 'many-rows', `More than ${SOFT_MAX_ROWS} flap rows: cells get narrow for VR`);

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  return {
    errors,
    warnings,
    issues,
    ok: errors.length === 0,
    structureOk: !errors.some((e) => e.category === 'structure'),
  };
}

export function issuesForPath(v: ValidationResult, path: string): Issue[] {
  return v.issues.filter((i) => i.path === path);
}
