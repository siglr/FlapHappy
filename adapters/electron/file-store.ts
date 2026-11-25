import * as fs from 'fs';
import * as path from 'path';
import type { ProfileStore, SaveOptions } from '../../core/sim';
import type { Profile, ProfileMeta, Settings } from '../../core/types';
import { exportProfileJson, normalizeProfile, sanitizeId } from '../../core/profile';
import { defaultSettings, normalizeSettings } from '../../core/settings';
import { DEMO_EXAMPLES } from '../../profiles';
import { cloneProfile } from '../../core/profile';
import { validateProfile } from '../../core/validate';

/** Write to a temp file, keep one `.bak` of the previous version, then rename over the target. */
export function atomicWrite(file: string, text: string): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, file + '.bak');
    } catch {
      // A failed backup must not block saving.
    }
  }
  fs.renameSync(tmp, file);
}

/**
 * Profile library: one `<id>.json` per profile in `<root>/profiles`, plus `<root>/settings.json`.
 * Plain JSON, human-editable and copyable between machines. No Electron dependency, so it is unit-tested.
 */
export class FileProfileStore implements ProfileStore {
  readonly profilesDir: string;
  readonly settingsFile: string;
  private settings: Settings | null = null;
  private demoExamples=false;
  setDemoExamples(on:boolean):void{this.demoExamples=on;}

  constructor(public readonly root: string) {
    this.profilesDir = path.join(root, 'profiles');
    this.settingsFile = path.join(root, 'settings.json');
    fs.mkdirSync(this.profilesDir, { recursive: true });
  }

  private fileFor(id: string): string {
    const safe = sanitizeId(id);
    if (!safe) throw new Error('Invalid profile id');
    return path.join(this.profilesDir, safe + '.json');
  }

  async list(): Promise<ProfileMeta[]> {
    const out: ProfileMeta[] = [];
    for (const name of fs.readdirSync(this.profilesDir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      try {
        const parsed = normalizeProfile(JSON.parse(fs.readFileSync(path.join(this.profilesDir, name), 'utf8')));
        if (!parsed.profile) throw new Error(parsed.errors.join('; '));
        const p = parsed.profile;
        out.push({
          id,
          filename: name,
          incomplete: !validateProfile(p).ok,
          match: p.match.title_contains.slice(),
          source: p.source,
        });
      } catch (e) {
        out.push({ id, filename: name, incomplete: true, match: [], source: 'user', error: e instanceof Error ? e.message : String(e) });
      }
    }
    if(this.demoExamples)for(const p of DEMO_EXAMPLES)if(!out.some(m=>m.id===p.id))out.push({id:p.id,filename:p.id+'.json',incomplete:!validateProfile(p).ok,match:p.match.title_contains.slice(),source:'preset'});
    out.sort((a, b) => a.filename.localeCompare(b.filename));
    return out;
  }

  async load(id: string): Promise<Profile> {
    const file=this.fileFor(id);
    if(this.demoExamples&&!fs.existsSync(file)){
      const example=DEMO_EXAMPLES.find(p=>p.id===id);if(example)return cloneProfile(example);
    }
    const text = fs.readFileSync(file, 'utf8');
    const r = normalizeProfile(JSON.parse(text));
    if (!r.profile) throw new Error(r.errors.join('; '));
    r.profile.id = sanitizeId(id);
    return r.profile;
  }

  async save(p: Profile, _opts?: SaveOptions): Promise<void> {
    atomicWrite(this.fileFor(p.id), exportProfileJson({...p,source:'user'}));
  }

  async remove(id: string): Promise<void> {
    const f = this.fileFor(id);
    if (fs.existsSync(f)) fs.renameSync(f, f + '.deleted.bak');
  }

  async getSettings(): Promise<Settings> {
    if (!this.settings) {
      try {
        this.settings = normalizeSettings(JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')));
      } catch {
        this.settings = defaultSettings();
      }
    }
    return JSON.parse(JSON.stringify(this.settings)) as Settings;
  }

  /** Replaces settings while keeping main-process-owned window bounds. */
  async setSettings(s: Settings): Promise<void> {
    const cur = await this.getSettings();
    const next = normalizeSettings(s);
    next.window = cur.window;
    next.main_window = cur.main_window;
    this.settings = next;
    this.flushSettings();
  }

  setWindowBounds(b: Settings['window']): void {
    const cur = this.settings ?? normalizeSettings(null);
    this.settings = { ...cur, window: b };
    this.flushSettings();
  }

  setMainWindowBounds(b: Settings['main_window']): void {
    const cur = this.settings ?? normalizeSettings(null);
    this.settings = { ...cur, main_window: b };
    this.flushSettings();
  }

  private flushSettings(): void {
    if (this.settings) atomicWrite(this.settingsFile, JSON.stringify(this.settings, null, 2) + '\n');
  }
}
