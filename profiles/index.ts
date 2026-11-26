import as3318 from './as33-18m.json';
import as3315 from './as33-15m.json';
import js3 from './js3.json';
import { normalizeProfile } from '../core/profile';
import type { Profile } from '../core/types';
import snapshot from './demo-wsg-snapshot.json';
import { parseWsgCatalog } from '../core/wsg-catalog';
import { verifyWsgReference } from '../core/wsg-reference';
import { wsgFlightProfile } from '../core/wsg-flight';

export interface Preset {
  id: string;
  label: string;
  profile: Profile;
}

function load(raw: unknown, label: string): Preset {
  const r = normalizeProfile(raw);
  if (!r.profile) throw new Error(`Bad built-in preset "${label}": ${r.errors.join('; ')}`);
  r.profile.source = 'preset';
  return { id: r.profile.id, label, profile: r.profile };
}

export const PRESETS: Preset[] = [
  load(as3318, 'AS33-18m'),
  load(as3315, 'AS33-15m'),
  load(js3, 'JS3'),
];

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Demo profiles are virtual snapshots of exact WSG variants, not network-backed
 * selections or personal files. Reuse the published-profile adapter so TAS VNE
 * remains a visual endpoint and no fictitious IAS maximum is created. PRESETS
 * above remain the original legacy definitions for the browser/testing paths. */
const catalog=parseWsgCatalog(snapshot.catalog);
const demoMappings=[['as33-18m','AS33-18-GF'],['as33-15m','AS33-15-GF'],['js3','JS3-18-BC']] as const;
export const DEMO_EXAMPLES:Profile[]=demoMappings.map(([id,key])=>{
  const published=catalog.profiles.find(p=>p.variantKey===key)??null;
  const reference=verifyWsgReference(key,snapshot.references[key],published);
  const profile=reference?wsgFlightProfile(reference,{}):null;
  if(!published||!profile)throw Error('Invalid offline Demo snapshot: '+key);
  return {...profile,id:'demo-'+id,source:'preset',match:{title_contains:PRESETS.find(p=>p.id===id)!.profile.match.title_contains.slice()},
    notes:'DEMO ONLY - WSG.org catalog revision '+catalog.revision+' ('+snapshot.capturedUtc+'), '+key+'. Simulator starting values, not aircraft performance data.'};
});
