import type { WsgPublishedProfile, WsgBand } from './wsg-catalog';
import { parseWsgCatalog } from './wsg-catalog';

/** Local record only. The mapping signature prevents silently transferring row
 * overrides across an aircraft or changed ordered flap definition. */
export interface WsgOverrides {
  mapping: string;
  ballastMode?: 'manual' | 'live';
  lightWeightKg?: number;
  heavyWeightKg?: number;
  lightStallIasKph?: number | null;
  heavyStallIasKph?: number | null;
  transitions?: Record<string, {lightStartKt?:number;heavyStartKt?:number;excludeFromDisplay?:boolean}>;
}
export type WsgOverrideMap = Record<string,WsgOverrides>;
export const mappingIdentity = (p:WsgPublishedProfile):string => JSON.stringify(p.bands.map(b=>[b.handleIndex,b.label]));
export const transitionIdentity = (from:WsgBand,to:WsgBand):string => JSON.stringify([[from.handleIndex,from.label],[to.handleIndex,to.label]]);
export function resolveWsgOverrides(base:WsgPublishedProfile, all:WsgOverrideMap): {state:'ok';profile:WsgPublishedProfile;ballastMode:'manual'|'live'} | {state:'mapping-changed'|'invalid'} {
  const override = all[base.variantKey];
  if (!override) return {state:'ok',profile:base,ballastMode:'live'};
  if (override.mapping !== mappingIdentity(base)) return {state:'mapping-changed'};
  const allowed = new Set(base.bands.slice(1).map((b,i)=>transitionIdentity(base.bands[i],b)));
  if (Object.keys(override.transitions??{}).some(k=>!allowed.has(k))) return {state:'invalid'};
  const weightsChanged = (override.lightWeightKg!==undefined && override.lightWeightKg!==base.lightWeightKg) || (override.heavyWeightKg!==undefined && override.heavyWeightKg!==base.heavyWeightKg);
  if (weightsChanged) {
    // An inherited speed at a different reference weight is not the same curve.
    if (!base.bands.slice(1).every((b,i)=>{const t=override.transitions?.[transitionIdentity(base.bands[i],b)];return t?.lightStartKt!==undefined && t?.heavyStartKt!==undefined;})) return {state:'invalid'};
    if ((base.lightStallIasKph!==null||base.heavyStallIasKph!==null) && (override.lightStallIasKph===undefined||override.heavyStallIasKph===undefined)) return {state:'invalid'};
  }
  try {
    const profile = {...base,
      lightWeightKg:override.lightWeightKg??base.lightWeightKg,
      heavyWeightKg:override.heavyWeightKg??base.heavyWeightKg,
      lightStallIasKph:override.lightStallIasKph===undefined?base.lightStallIasKph:override.lightStallIasKph,
      heavyStallIasKph:override.heavyStallIasKph===undefined?base.heavyStallIasKph:override.heavyStallIasKph,
      bands:base.bands.map((b,i)=>{
        if(i===0) return {...b};
        const t=override.transitions?.[transitionIdentity(base.bands[i-1],b)];
        return {...b,lightStartKt:t?.lightStartKt??b.lightStartKt,heavyStartKt:t?.heavyStartKt??b.heavyStartKt,excludeFromDisplay:t?.excludeFromDisplay??b.excludeFromDisplay};
      })};
    const validated = parseWsgCatalog({schema:'wsg.flaphappy.catalog/2',revision:1,profiles:[{...profile,schema:'wsg.flaphappy.profile/1',handleCount:profile.bands.length}]}).profiles[0];
    return {state:'ok',profile:validated,ballastMode:override.ballastMode==='manual'?'manual':'live'};
  } catch { return {state:'invalid'}; }
}

/** Reset removes only the local variant record, never public data. */
export function resetWsgOverrides(all:WsgOverrideMap,variantKey:string):WsgOverrideMap {
  const result={...all}; delete result[variantKey]; return result;
}

/** Settings decoder: preserve well-formed local records even if a later catalog
 * changes their mapping. Never accept arbitrary imported object properties. */
export function normalizeWsgOverrides(raw:unknown):WsgOverrideMap {
  const obj=(x:unknown):Record<string,unknown>|null=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:null;
  const root=obj(raw); const out:WsgOverrideMap=Object.create(null);
  if(!root) return out;
  const positive=(x:unknown):x is number=>typeof x==='number'&&isFinite(x)&&x>0;
  for(const key of Object.keys(root)) {
    const item=obj(root[key]);
    if(!item||!key.trim()||key.length>100||typeof item.mapping!=='string'||item.mapping.length>4096) continue;
    const row:WsgOverrides={mapping:item.mapping};
    if(item.ballastMode==='manual'||item.ballastMode==='live') row.ballastMode=item.ballastMode;
    for(const field of ['lightWeightKg','heavyWeightKg'] as const) if(positive(item[field])) row[field]=item[field];
    for(const field of ['lightStallIasKph','heavyStallIasKph'] as const) if(item[field]===null||positive(item[field])) row[field]=item[field];
    const transitions=obj(item.transitions);
    if(transitions) {
      const mapped:NonNullable<WsgOverrides['transitions']>=Object.create(null);
      for(const id of Object.keys(transitions)) {
        if(id.length>256) continue;
        const val=obj(transitions[id]); if(!val) continue;
        const change:NonNullable<WsgOverrides['transitions']>[string]={};
        for(const field of ['lightStartKt','heavyStartKt'] as const) if(positive(val[field])) change[field]=val[field];
        if(typeof val.excludeFromDisplay==='boolean') change.excludeFromDisplay=val.excludeFromDisplay;
        if(Object.keys(change).length) mapped[id]=change;
      }
      row.transitions=mapped;
    }
    out[key]=row;
  }
  return out;
}
