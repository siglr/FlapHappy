import type { ProfileStore } from '../../core/sim';
import type { Profile, ProfileMeta, Settings } from '../../core/types';
import { cloneProfile, profileFileName } from '../../core/profile';
import { defaultSettings, normalizeSettings } from '../../core/settings';
import { DEMO_EXAMPLES } from '../../profiles';
import { validateProfile } from '../../core/validate';

export function metaOf(p: Profile): ProfileMeta {
  return {
    id: p.id,
    filename: profileFileName(p.id),
    incomplete: !validateProfile(p).ok,
    match: p.match.title_contains.slice(),
    source: p.source,
  };
}

export class MemoryProfileStore implements ProfileStore {
  private profiles = new Map<string, Profile>();
  private settings: Settings = defaultSettings();
  private demoExamples=false;
  setDemoExamples(on:boolean):void{this.demoExamples=on;}

  constructor(seed: Profile[] = []) {
    for (const p of seed) this.profiles.set(p.id, cloneProfile(p));
  }

  async list(): Promise<ProfileMeta[]> {
    return [...Array.from(this.profiles.values()),...(this.demoExamples?DEMO_EXAMPLES.filter(p=>!this.profiles.has(p.id)):[])].map(metaOf);
  }

  async load(id: string): Promise<Profile> {
    const p = this.profiles.get(id)??(this.demoExamples?DEMO_EXAMPLES.find(p=>p.id===id):undefined);
    if (!p) throw new Error('No such profile: ' + id);
    return cloneProfile(p);
  }

  async save(p: Profile): Promise<void> {
    this.profiles.set(p.id, cloneProfile(p));
  }

  async remove(id: string): Promise<void> {
    this.profiles.delete(id);
  }

  async getSettings(): Promise<Settings> {
    return normalizeSettings(this.settings);
  }

  async setSettings(s: Settings): Promise<void> {
    this.settings = normalizeSettings(s);
  }
}
