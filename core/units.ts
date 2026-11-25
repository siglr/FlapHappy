/** Display unit. Profile files store metres per second; the app works in knots. */
export type SpeedUnit = 'kt' | 'kmh';

/** International nautical mile: 1 knot = 1.852 km/h = 1852/3600 m/s. */
export const KT_TO_KMH = 1.852;
export const KT_TO_MS = 1852 / 3600;
export const MS_TO_KT = 3600 / 1852;

export function unitLabel(unit: SpeedUnit): string {
  return unit === 'kmh' ? 'km/h' : 'kt';
}

/** Metres per second for a saved profile, to two decimal places. */
export function knotsToMs(kt: number): number {
  return Math.round(kt * KT_TO_MS * 100) / 100;
}

/** Knots from a saved m/s value, to 0.1 kt. */
export function msToKnots(ms: number): number {
  return Math.round(ms * MS_TO_KT * 10) / 10;
}

export function knotsToUnit(kt: number, unit: SpeedUnit): number {
  return unit === 'kmh' ? kt * KT_TO_KMH : kt;
}

export function unitToKnots(value: number, unit: SpeedUnit): number {
  const kt = unit === 'kmh' ? value / KT_TO_KMH : value;
  return Math.round(kt * 10) / 10;
}

/** Whole number for the IAS readout, with the unit suffix. */
export function formatIas(kt: number | null, unit: SpeedUnit): string {
  if (kt === null || !isFinite(kt)) return '--- ' + unitLabel(unit);
  return String(Math.round(knotsToUnit(kt, unit))) + ' ' + unitLabel(unit);
}

/** International foot. The sim reports height above ground in feet. */
export const FT_TO_M = 0.3048;
/** Default height-bar ends, in feet. */
export const AGL_LO_FT = 200;
export const AGL_HI_FT = 1000;
/** Default green band, inclusive, in feet. Outside it the fill is blue. */
export const AGL_GREEN_LO_FT = 400;
export const AGL_GREEN_HI_FT = 800;

/** Height-bar ends and the green band. Saved in metres, to two decimal places. */
export interface AglScale {
  bottom_m: number;
  top_m: number;
  low_m: number;
  high_m: number;
}

/** Metres for a saved altitude, to two decimal places. */
export function roundMetres(m: number): number {
  return Math.round(m * 100) / 100;
}

export function feetToMetres(ft: number): number {
  return roundMetres(ft * FT_TO_M);
}

export function defaultAglScale(): AglScale {
  return {
    bottom_m: feetToMetres(AGL_LO_FT),
    top_m: feetToMetres(AGL_HI_FT),
    low_m: feetToMetres(AGL_GREEN_LO_FT),
    high_m: feetToMetres(AGL_GREEN_HI_FT),
  };
}

/** Height shown on the AGL bar. Independent of the speed unit. */
export type HeightUnit = 'ft' | 'm';

export function heightUnitLabel(unit: HeightUnit): string {
  return unit === 'm' ? 'm' : 'ft';
}

/** Ordered ends in feet. Equal Bottom and Top fall back to the defaults. Low and High swap when reversed. */
export function aglSpan(scale: AglScale): { bottom: number; top: number; low: number; high: number } {
  let bottom = scale.bottom_m / FT_TO_M;
  let top = scale.top_m / FT_TO_M;
  if (!(bottom < top)) {
    const swap = bottom;
    bottom = top;
    top = swap;
  }
  if (!(bottom < top)) {
    bottom = AGL_LO_FT;
    top = AGL_HI_FT;
  }
  let low = scale.low_m / FT_TO_M;
  let high = scale.high_m / FT_TO_M;
  if (low > high) {
    const swap = low;
    low = high;
    high = swap;
  }
  return { bottom, top, low, high };
}

/** 0 at Bottom, 1 at Top. Below Bottom stays empty; above Top stays full. */
export function aglBarPos(ft: number, scale: AglScale = defaultAglScale()): number {
  const span = aglSpan(scale);
  const width = span.top - span.bottom;
  if (ft <= span.bottom) return 0;
  if (ft >= span.top) return 1;
  return (ft - span.bottom) / width;
}

/** Light ticks at Low, the middle of the green band, and High. Null when a tick sits outside the bar. */
export function aglMarkPositions(scale: AglScale = defaultAglScale()): Array<number | null> {
  const span = aglSpan(scale);
  const width = span.top - span.bottom;
  const marks = [span.low, (span.low + span.high) / 2, span.high];
  const out: Array<number | null> = [];
  for (let i = 0; i < marks.length; i++) {
    const ft = marks[i];
    out.push(ft < span.bottom || ft > span.top ? null : (ft - span.bottom) / width);
  }
  return out;
}

export function aglMarkLabels(unit: HeightUnit, scale: AglScale = defaultAglScale()): string[] {
  const span = aglSpan(scale);
  const marks = [span.low, (span.low + span.high) / 2, span.high];
  const out: string[] = [];
  for (let i = 0; i < marks.length; i++) out.push(String(Math.round(unit === 'm' ? marks[i] * FT_TO_M : marks[i])));
  return out;
}

/** Whole feet or metres for an Advanced field. Stored values stay in metres. */
export function metresToHeight(m: number, unit: HeightUnit): number {
  return Math.round(unit === 'm' ? m : m / FT_TO_M);
}

/** Metres stored from a whole-number Advanced field, to two decimal places. */
export function heightToMetres(value: number, unit: HeightUnit): number {
  return roundMetres(unit === 'm' ? value : value * FT_TO_M);
}

/** Whole-number height above ground, and a 0..1 fill on the Bottom–Top bar. */
export function formatAgl(ft: number | null, unit: HeightUnit, scale: AglScale = defaultAglScale()): { text: string; pos: number | null; inBand: boolean } {
  const suffix = heightUnitLabel(unit);
  if (ft === null || !isFinite(ft)) return { text: '--- ' + suffix, pos: null, inBand: false };
  const shown = Math.max(0, ft);
  const span = aglSpan(scale);
  const value = unit === 'm' ? shown * FT_TO_M : shown;
  return {
    text: String(Math.round(value)) + ' ' + suffix,
    pos: aglBarPos(shown, scale),
    inBand: shown >= span.low && shown <= span.high,
  };
}

/** Whole number for a tick under the bar. */
export function formatTick(kt: number, unit: SpeedUnit): string {
  return String(Math.round(knotsToUnit(kt, unit)));
}

/** Editor field: at most one fractional digit; the underlying value is not changed. */
export function formatSpeedField(kt: number | null, unit: SpeedUnit): string {
  if (kt === null || !isFinite(kt)) return '';
  return String(Math.round(knotsToUnit(kt, unit)*10)/10);
}
