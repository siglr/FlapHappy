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

export type ProfileChoice = { kind:'manual'|'assigned'|'local'|'fallback'; id:string } | {kind:'wsg'; variantKey:string} | {kind:'none'|'pending'};

/** Selection policy independent of the app/window or source implementation. WSG
 * is passed only after an exact verified match and a usable effective profile.
 * A fallback is a deliberate setting, never an implicit last-used profile. */
export function resolveProfileChoice(metas: ProfileMeta[], settings: Settings, title: string | null, bindingKey: string | null, published: { pending:boolean; usableVariantKey:string|null }): ProfileChoice {
  const usable = metas.filter(m => !m.error && !m.incomplete);
  const valid = (id:string|null|undefined): id is string => !!id && usable.some(m=>m.id===id);
  const selection = settings.profile_selection;
  if (selection.mode === 'manual') return valid(selection.manualId) ? {kind:'manual',id:selection.manualId} : {kind:'none'};
  if (!title) return {kind:'none'};
  const explicit = (bindingKey ? settings.active_by_title[bindingKey] : undefined) ?? settings.active_by_title[title];
  if (valid(explicit)) return {kind:'assigned',id:explicit};
  if (published.pending) return {kind:'pending'};
  if (published.usableVariantKey) return {kind:'wsg',variantKey:published.usableVariantKey};
  const local = usable.filter(m=>profileMatchesTitle(m.match,title));
  if (local.length === 1) return {kind:'local',id:local[0].id};
  return valid(selection.fallbackId) ? {kind:'fallback',id:selection.fallbackId} : {kind:'none'};
}