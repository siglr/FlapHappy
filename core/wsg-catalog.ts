/** Published WSG data is a separate read-only source, not a local flight profile. */
export interface WsgBand {
  label: string;
  handleIndex: number;
  lightStartKt: number;
  heavyStartKt: number;
  excludeFromDisplay: boolean;
}
export interface WsgPublishedProfile {
  variantKey: string;
  lightWeightKg: number;
  heavyWeightKg: number;
  lightStallIasKph: number | null;
  heavyStallIasKph: number | null;
  bands: WsgBand[];
}
export interface WsgCatalog { revision: number; profiles: WsgPublishedProfile[]; }

const object = (v: unknown): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('Invalid published WSG profile data');
  return v as Record<string, unknown>;
};
const positive = (v: unknown): number => {
  if (typeof v !== 'number' || !isFinite(v) || v <= 0) throw new Error('Expected a positive published value');
  return v;
};
const integer = (v: unknown, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error('Invalid published index or revision');
  return v;
};
const label = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('Invalid published label');
  return v;
};
export function parseWsgCatalog(raw: unknown): WsgCatalog {
  const root = object(raw);
  if (root.schema !== 'wsg.flaphappy.catalog/2' || !Array.isArray(root.profiles) || root.profiles.length > 250) throw new Error('Unsupported WSG catalog');
  const revision = integer(root.revision, 1, 2147483647);
  const seen = new Set<string>();
  const profiles: WsgPublishedProfile[] = root.profiles.map(item => {
    const p = object(item);
    if (p.schema !== 'wsg.flaphappy.profile/1') throw new Error('Unsupported WSG profile version');
    const variantKey = label(p.variantKey, 100);
    const folded = variantKey.toLowerCase();
    if (seen.has(folded)) throw new Error('Duplicate WSG variant'); seen.add(folded);
    const lightWeightKg = positive(p.lightWeightKg), heavyWeightKg = positive(p.heavyWeightKg);
    if (heavyWeightKg <= lightWeightKg) throw new Error('Invalid WSG weight anchors');
    const count = integer(p.handleCount, 2, 32);
    if (!Array.isArray(p.bands) || p.bands.length !== count) throw new Error('Incomplete WSG flap mapping');
    const handles = new Set<number>(), labels = new Set<string>();
    let lastLight = 0, lastHeavy = 0;
    const bands = p.bands.map((data, i): WsgBand => {
      const b = object(data); const name = label(b.label, 12); const handleIndex = integer(b.handleIndex, 0, count - 1);
      if (handles.has(handleIndex) || labels.has(name.toLowerCase())) throw new Error('Duplicate WSG flap mapping');
      handles.add(handleIndex); labels.add(name.toLowerCase());
      if (b.excludeFromDisplay !== undefined && typeof b.excludeFromDisplay !== 'boolean') throw new Error('Invalid WSG exclusion flag');
      if (i === 0) {
        if (b.lightStartKt !== 0 || b.heavyStartKt !== 0 || b.excludeFromDisplay === true) throw new Error('Invalid WSG starting flap');
        return { label:name, handleIndex, lightStartKt:0, heavyStartKt:0, excludeFromDisplay:false };
      }
      const l = positive(b.lightStartKt), h = positive(b.heavyStartKt);
      if (l <= lastLight || h <= lastHeavy || l >= 300 || h >= 300) throw new Error('Invalid WSG trigger order or range');
      lastLight=l; lastHeavy=h;
      return { label:name, handleIndex, lightStartKt:l, heavyStartKt:h, excludeFromDisplay:b.excludeFromDisplay === true };
    });
    const hasStall = p.lightStallIasKph != null || p.heavyStallIasKph != null;
    const lightStallIasKph = hasStall ? positive(p.lightStallIasKph) : null;
    const heavyStallIasKph = hasStall ? positive(p.heavyStallIasKph) : null;
    const first = bands.slice(1).find(b => !b.excludeFromDisplay);
    if (lightStallIasKph !== null && heavyStallIasKph !== null && (lightStallIasKph >= 555.6 || heavyStallIasKph >= 555.6 || (first && (lightStallIasKph >= first.lightStartKt * 1.852 || heavyStallIasKph >= first.heavyStartKt * 1.852)))) throw new Error('Invalid WSG stall IAS');
    return {variantKey,lightWeightKg,heavyWeightKg,lightStallIasKph,heavyStallIasKph,bands};
  });
  return {revision, profiles};
}
