import type { WsgPublishedProfile } from './wsg-catalog';

/** Local aircraft identity: never transmit the path or simulator TITLE to WSG. */
export function aircraftContainer(path: string): string | null {
  if (typeof path !== 'string') return null;
  const parts = path.replace(/\\/g, '/').split('/');
  const i = parts.findIndex((p, j) => p.toLowerCase() === 'simobjects' && parts[j+1]?.toLowerCase() === 'airplanes');
  const name = i >= 0 ? parts[i+2] : null;
  return name && /^[a-zA-Z0-9_-]{1,150}$/.test(name) && parts[parts.length-1].toLowerCase() === 'aircraft.cfg' ? name : null;
}

export function aircraftVariantAlias(container: string | null, wingMetres: number | null): string | null {
  if (typeof container !== 'string' || !container || !/^[a-zA-Z0-9_-]{1,150}$/.test(container) || typeof wingMetres !== 'number' || !isFinite(wingMetres) || wingMetres < 5 || wingMetres > 40) return null;
  const span = Math.round(wingMetres);
  if (Math.abs(wingMetres - span) > 0.1) return null;
  const tokens = container.split(/[_-]/);
  if (tokens.length < 2) return null; // bare type code does not identify an add-on
  const suffix = tokens[tokens.length-1];
  if (/^\d+m$/i.test(suffix)) return Number(suffix.slice(0,-1)) === span ? container : null;
  return container + '_' + span + 'm';
}

/** Only exact literal aliases (even if represented by an anchored regex) are usable. */
export function exactWsgVariant(alias: string, response: unknown): string | null {
  const r = response as {ok?: unknown; rules?: unknown; gliders?: unknown};
  if (!r || r.ok !== true || !Array.isArray(r.rules) || !Array.isArray(r.gliders)) return null;
  const candidates = new Map<string,string>();
  for (const rule of r.rules) {
    if (!rule || typeof rule.Pattern !== 'string' || typeof rule.GliderKey !== 'string') continue;
    let literal = rule.Pattern;
    if (rule.RuleType === 'REGEX' && /^\^[a-zA-Z0-9_-]+\$?$/.test(literal)) literal = literal.slice(1).replace(/\$$/, '');
    else if (rule.RuleType !== 'EXACT') continue;
    if (literal.toLowerCase() === alias.toLowerCase()) candidates.set(rule.GliderKey.toLowerCase(), rule.GliderKey);
  }
  if (candidates.size !== 1) return null;
  const key = Array.from(candidates.values())[0];
  return r.gliders.some(g => g && typeof g.GliderKey === 'string' && g.GliderKey.toLowerCase() === key.toLowerCase()) ? key : null;
}

export interface WsgAircraftMatch { variantKey: string; displayName: string; profile: WsgPublishedProfile | null; visualVneTasKph?: number|null; }
export function verifyWsgReference(key: string, response: unknown, profile: WsgPublishedProfile | null): WsgAircraftMatch | null {
  const r = response as {ok?: unknown; schemaVersion?: unknown; status?: unknown; glider?: any};
  if (!r || r.ok !== true || r.schemaVersion !== 1 || r.status !== 'matched' || typeof r.glider?.gliderKey !== 'string' || r.glider.gliderKey.toLowerCase() !== key.toLowerCase()) return null;
  if (profile) {
    if (r.glider.hasFlaps !== true || r.glider.flapCount !== profile.bands.length || !r.glider.flapLabels) return null;
    for (const b of profile.bands) if (String(r.glider.flapLabels[String(b.handleIndex+1)] ?? '') !== b.label) return null;
  }
  return {variantKey:key,displayName:typeof r.glider.displayName === 'string' ? r.glider.displayName : key,profile,visualVneTasKph:typeof r.glider.vneTasKph==='number'&&isFinite(r.glider.vneTasKph)&&r.glider.vneTasKph>0?r.glider.vneTasKph:null};
}
