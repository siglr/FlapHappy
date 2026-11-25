import { wsgBoundaries,wsgGroups } from './wsg-flight';
import type { Profile, ValidationResult } from './types';
import type { SimSample } from './sim';
import type { CurrentFlap } from './flapmap';
import { bucketIndex, columnEdges, effectiveBoundaries, flapGroups, mapMarker, type MarkerRegion } from './scale';
import { interpolationFraction, liveWeight, type WeightState } from './weight';
import { aglMarkLabels, aglMarkPositions, defaultAglScale, formatAgl, formatIas, formatTick, type AglScale, type HeightUnit, type SpeedUnit } from './units';

export type LinkState = 'waiting' | 'nodata' | 'paused' | 'live';

export const STALE_MS = 1500;
export const GROUND_SPEED_KT = 25;

export function deriveLink(sample: SimSample | null, lastRxMs: number, nowMs: number): LinkState {
  if (!sample || !sample.connected) return 'waiting';
  if (nowMs - lastRxMs > STALE_MS) return 'nodata';
  if (!sample.inFlight) return 'paused';
  return 'live';
}

export interface CellModel {
  label: string;
  state: 'current' | 'other';
}

export interface FlapBadge {
  kind: 'unknown' | 'other' | 'manual' | 'mapped';
  text: string;
}

export interface DisplayModel {
  mode: 'none' | 'noflaps' | 'incomplete' | 'ok';
  link: LinkState;
  statusText: string | null;
  /** Bar drawn (all speeds valid at the current ballast). */
  barVisible: boolean;
  boundaries: number[] | null;
  edges: number[] | null;
  /** Left edge of each flap cell. One column per flap, so this matches `edges`. */
  cellEdges: number[] | null;
  ticks: string[] | null;
  cells: CellModel[];
  iasText: string;
  weight: WeightState;
  /** Height above ground. The bar runs from Bottom to Top. */
  aglText: string;
  aglPos: number | null;
  /** Green while the height is from Low to High, inclusive. */
  aglInBand: boolean;
  /** Tick labels at Low, the middle of that band, and High, in the current height unit. */
  aglMarks: string[];
  /** Same ticks as fractions of the bar. Null hides a tick that falls outside Bottom–Top. */
  aglMarkPos: Array<number | null>;
  /** Ambient wind speed, shown on the left of the height bar. */
  windText: string;
  marker: { pos: number | null; region: MarkerRegion | null; greyed: boolean };
  alert: 'LOW' | 'FAST' | null;
  badge: FlapBadge | null;
  incompleteMessage: string | null;
  /** Row of the highlighted cell, or null. */
  currentRow: number | null;
  /** Simple guidance uses the same ordered profile buckets as the IAS marker. */
  simple: { current: string | null; suggestion: { label: string; direction: 'slower' | 'faster' } | null };
  recommendedRow:number|null;
}

export interface ModelInput {
  profile: Profile | null;
  validation: ValidationResult | null;
  sample: SimSample | null;
  link: LinkState;
  /** Stored manual fraction, used only when the loaded-weight anchors are incomplete. */
  manualBallast?: number;
  /** IAS after display smoothing (falls back to the raw sample when null). */
  ias: number | null;
  /** Height after the same smoothing (falls back to the raw sample when null). */
  aglFt?: number | null;
  flap: CurrentFlap;
  /** Display unit. The profile's working speeds are knots. */
  units?: SpeedUnit;
  /** Height unit for the AGL bar. */
  height?: HeightUnit;
  /** AGL bar ends and the green band, in feet. */
  agl?: AglScale;
}

const STATUS: Record<LinkState, string | null> = {
  waiting: 'Waiting for MSFS...',
  nodata: 'No data',
  paused: 'Paused or not in flight',
  live: null,
};

export function buildDisplayModel(inp: ModelInput): DisplayModel {
  const { profile, validation, sample, link, flap } = inp;
  const weight = liveWeight(profile, sample, link === 'live');
  const units = inp.units === 'kmh' ? 'kmh' : 'kt';
  const height: HeightUnit = inp.height === 'm' ? 'm' : 'ft';
  const aglScale = inp.agl ?? defaultAglScale();
  const base: DisplayModel = {
    mode: 'none',
    link,
    statusText: STATUS[link],
    barVisible: false,
    boundaries: null,
    edges: null,
    cellEdges: null,
    ticks: null,
    cells: [],
    iasText: formatIas(null, units),
    weight,
    aglText: formatAgl(null, height, aglScale).text,
    aglPos: null,
    aglInBand: false,
    aglMarks: aglMarkLabels(height, aglScale),
    aglMarkPos: aglMarkPositions(aglScale),
    windText: formatIas(null, units),
    marker: { pos: null, region: null, greyed: false },
    alert: null,
    badge: null,
    incompleteMessage: null,
    currentRow: null,
    simple: { current: null, suggestion: null },
    recommendedRow:null,
  };
  if (!profile || !validation) {
    base.incompleteMessage = 'no profile: open settings';
    return base;
  }

  const live = link === 'live';
  const rawIas = inp.ias ?? (sample ? sample.iasKt : null);
  const hasIas = live && rawIas !== null && isFinite(rawIas);
  const shown = sample ? sample.iasKt : null;
  if (live && shown !== null && isFinite(shown)) base.iasText = formatIas(shown, units);
  if (live && sample && sample.aglFt !== null && isFinite(sample.aglFt)) {
    const smoothed = inp.aglFt !== undefined && inp.aglFt !== null && isFinite(inp.aglFt) ? inp.aglFt : sample.aglFt;
    const agl = formatAgl(sample.aglFt, height, aglScale);
    const bar = formatAgl(smoothed, height, aglScale);
    base.aglText = agl.text;
    base.aglPos = bar.pos;
    base.aglInBand = bar.inBand;
  }
  if (live && sample && sample.windKt !== null && isFinite(sample.windKt)) {
    base.windText = formatIas(Math.max(0, sample.windKt), units);
  }

  const n = profile.flaps.length;
  const fraction = interpolationFraction(profile, weight, inp.manualBallast);
  const boundaries = validation.ok && fraction !== null ? (profile.wsg?wsgBoundaries(profile,fraction):effectiveBoundaries(profile, fraction)) : null;
  base.mode = n === 0 ? 'noflaps' : validation.ok ? 'ok' : 'incomplete';
  if (base.mode === 'incomplete') base.incompleteMessage = 'profile incomplete: open settings';
  else if (fraction===null && weight.anchorsValid && weight.kg === null) base.incompleteMessage = 'Flying weight unavailable';

  // Exclusion merges neighboring cells but never changes the native handle.
  const groups=flapGroups(profile);
  if (n > 0 && validation.structureOk) {
    const current = live || link === 'paused' || link === 'nodata' ? flap.rowIndex : null;
    const group=current===null?-1:groups.members.findIndex(m=>m.includes(current));
    base.currentRow=group<0?null:group;
    base.cells=groups.labels.map((label,i)=>({label,state:base.currentRow===i?'current':'other'}));
    if(base.currentRow!==null&&groups.members[base.currentRow].length>1&&flap.label)
      base.badge={kind:'mapped',text:flap.label};
  } else if (n > 0) {
    base.cells=groups.labels.map(label=>({label,state:'other'}));
  }

  if(profile.wsg&&n>0&&validation.structureOk){
    const groups=wsgGroups(profile);
    const exact=live?flap.rowIndex:null;
    base.currentRow=exact===null?null:groups.members.findIndex(m=>m.includes(exact));
    if(base.currentRow===-1)base.currentRow=null;
    base.cells=groups.labels.map((label,i)=>({label,state:base.currentRow===i?'current':'other'}));
    if(base.currentRow!==null&&groups.members[base.currentRow].length>1&&flap.label)base.badge={kind:'mapped',text:flap.label};
  }else if(profile.wsg){base.currentRow=null;base.cells=[];}

  if (link !== 'waiting') {
    if (flap.status === 'unknown' && n > 0) base.badge = { kind: 'unknown', text: 'FLAP ?' };
    else if (flap.status === 'unlisted') base.badge = { kind: 'other', text: flap.label ?? '?' };
    else if (flap.via === 'manual') base.badge = { kind: 'manual', text: 'manual' };
  }

  const mappedRow = live && validation.structureOk && flap.status === 'row' &&
    flap.rowIndex !== null && flap.rowIndex >= 0 && flap.rowIndex < n ? flap.rowIndex : null;
  if (mappedRow !== null) base.simple.current = profile.flaps[mappedRow].label;
  else if (live && flap.status === 'unlisted') base.simple.current = flap.label;

  if (boundaries) {
    base.barVisible = true;
    base.boundaries = boundaries;
    base.edges = columnEdges(boundaries);
    base.cellEdges = base.edges;
    base.ticks = boundaries.map((b) => formatTick(b, units));
    // Recommendations use the same received IAS in desktop and cockpit; smoothing is visual only.
    const recommendationIas = sample ? sample.iasKt : null;
    if (mappedRow !== null && sample && sample.onGround !== true &&
        recommendationIas !== null && isFinite(recommendationIas) && recommendationIas >= GROUND_SPEED_KT) {
      let row = bucketIndex(recommendationIas, boundaries);
      if(profile.wsg&&profile.vne===null&&recommendationIas>boundaries[boundaries.length-1])row=base.cells.length-1;
      const currentGroup=base.currentRow;
      if (currentGroup!==null && row >= 0 && row < base.cells.length && row !== currentGroup) {
        base.recommendedRow=row;
        base.simple.suggestion = { label: base.cells[row].label, direction: row < currentGroup ? 'slower' : 'faster' };
      }
    }
    if (hasIas) {
      const ias = rawIas as number;
      const grey = (sample && sample.onGround === true) || ias < GROUND_SPEED_KT;
      if (grey) {
        base.marker = { pos: null, region: null, greyed: true };
      } else {
        const m = mapMarker(ias, boundaries, base.edges);
        base.marker = { pos: m.pos, region: m.region, greyed: false };
        base.alert = m.region === 'below' && (!profile.wsg || profile.vs_min.no_ballast_kt!==null) ? 'LOW' : m.region === 'above' && (!profile.wsg||profile.vne!==null) ? 'FAST' : null;
      }
    }
  }
  return base;
}
