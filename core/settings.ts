import { SETTINGS_SCHEMA, type Settings } from './types';
import { defaultAglScale, feetToMetres, roundMetres, type SpeedUnit } from './units';
import { clamp01 } from './profile';

export function defaultSettings(): Settings {
  return {
    schema: SETTINGS_SCHEMA,
    last_profile_id: null,
    active_by_title: {},
    ballast_by_profile: {},
    units: 'kt',
    height: 'ft',
    agl: defaultAglScale(),
    ui: { compact: true, always_on_top: false, opacity: 1, zoom: 1, demo_mode: false, show_ballast: true, show_agl: true, show_transitions: false, show_wind: true, bar_shading: true },
    wsg_profiles_enabled: false,
    window: null,
  };
}

function obj(x: unknown): Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

/** Current settings only. A missing file or another schema id falls back to defaults. Malformed fields do too. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  const r = obj(raw);
  if (r.schema !== SETTINGS_SCHEMA) return d;
  const ui = obj(r.ui);
  const byTitle: Record<string, string> = {};
  const t = obj(r.active_by_title);
  for (const k of Object.keys(t)) if (typeof t[k] === 'string') byTitle[k] = t[k] as string;
  const ballast: Record<string, number> = {};
  const b = obj(r.ballast_by_profile);
  for (const k of Object.keys(b)) if (typeof b[k] === 'number' && isFinite(b[k] as number)) ballast[k] = clamp01(b[k] as number);
  const w = obj(r.window);
  const win =
    typeof w.x === 'number' && typeof w.y === 'number' && typeof w.width === 'number' && typeof w.height === 'number'
      ? { x: w.x, y: w.y, width: w.width, height: w.height }
      : null;
  const num = (x: unknown, def: number, lo: number, hi: number) =>
    typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def;
  const units: SpeedUnit = r.units === 'kmh' ? 'kmh' : 'kt';
  const height = r.height === 'm' || r.height === 'ft' ? r.height : units === 'kmh' ? 'm' : 'ft';
  const aglIn = obj(r.agl);
  const aglM = (m: unknown, ft: unknown, def: number) => {
    const n = typeof m === 'number' && isFinite(m) ? m : typeof ft === 'number' && isFinite(ft) ? feetToMetres(ft) : def;
    return Math.max(0, Math.min(18288, roundMetres(n)));
  };
  return {
    schema: SETTINGS_SCHEMA,
    last_profile_id: typeof r.last_profile_id === 'string' ? r.last_profile_id : null,
    active_by_title: byTitle,
    ballast_by_profile: ballast,
    units,
    height,
    agl: {
      bottom_m: aglM(aglIn.bottom_m, aglIn.bottom_ft, d.agl.bottom_m),
      top_m: aglM(aglIn.top_m, aglIn.top_ft, d.agl.top_m),
      low_m: aglM(aglIn.low_m, aglIn.low_ft, d.agl.low_m),
      high_m: aglM(aglIn.high_m, aglIn.high_ft, d.agl.high_m),
    },
    ui: {
      compact: true,
      always_on_top: ui.always_on_top === true,
      opacity: num(ui.opacity, d.ui.opacity, 0.3, 1),
      zoom: num(ui.zoom, d.ui.zoom, 0.5, 3),
      demo_mode: ui.demo_mode === true,
      show_ballast: ui.show_ballast !== false,
      show_agl: ui.show_agl !== false,
      show_transitions: ui.show_transitions === true,
      show_wind: ui.show_wind !== false,
      bar_shading: ui.bar_shading !== false,
    },
    wsg_profiles_enabled: r.wsg_profiles_enabled === true,
    window: win,
  };
}
