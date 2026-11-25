import as3318 from './as33-18m.json';
import as3315 from './as33-15m.json';
import js3 from './js3.json';
import { cloneProfile, normalizeProfile } from '../core/profile';
import type { Profile } from '../core/types';

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

/** Demo examples are virtual, never seeded into the personal profile folder. */
export const DEMO_EXAMPLES:Profile[]=PRESETS.map(p=>({...cloneProfile(p.profile),id:'demo-'+p.id,source:'preset',notes:'DEMO ONLY - '+p.profile.notes}));
