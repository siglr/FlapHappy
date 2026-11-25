import type { ProfileMeta, Settings } from './types';
import { profileMatchesTitle } from './profile';

/** Auto-select: manual choice remembered per aircraft title, then `match.title_contains`, then last used. */
export function selectProfileId(metas: ProfileMeta[], settings: Settings, title: string | null): string | null {
  const usable = metas.filter((m) => !m.error);
  const has = (id: string | null | undefined): id is string => !!id && usable.some((m) => m.id === id);
  if (title && has(settings.active_by_title[title])) return settings.active_by_title[title];
  if (title) {
    const hit = usable.find((m) => !m.incomplete && profileMatchesTitle(m.match, title)) ?? usable.find((m) => profileMatchesTitle(m.match, title));
    if (hit) return hit.id;
  }
  if (has(settings.last_profile_id)) return settings.last_profile_id;
  return usable.length ? usable[0].id : null;
}

/** Live aircraft selection never falls back to the last unrelated profile. */
export function selectLiveProfileId(metas: ProfileMeta[], settings: Settings, title: string, bindingKey = title): string | null {
  const usable = metas.filter(m => !m.error);
  const remembered = settings.active_by_title[bindingKey] ?? settings.active_by_title[title];
  if (remembered && usable.some(m => m.id === remembered)) return remembered;
  const matching = usable.filter(m => !m.incomplete && profileMatchesTitle(m.match, title));
  return matching.length === 1 ? matching[0].id : null;
}
