import { aircraftVariantAlias, exactWsgVariant, verifyWsgReference, type WsgAircraftMatch } from '../../core/wsg-reference';
import { parseWsgCatalog, type WsgCatalog } from '../../core/wsg-catalog';

export const WSG_PUBLIC_CATALOG = 'https://wesimglide.org/api/flap-happy/catalog-v2.json';
const LIMIT = 262144;

/** Fixed anonymous public endpoint. No account, cookies, tokens, or user data. */
export async function loadPublishedWsgCatalog(fetcher: typeof fetch = fetch): Promise<WsgCatalog> {
  return parseWsgCatalog(await publicJson(WSG_PUBLIC_CATALOG, fetcher));
}

async function publicJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, { method: 'GET', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json') || !response.body) throw new Error('Published WSG catalog unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > LIMIT) { await reader.cancel(); throw new Error('Published WSG catalog is too large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

/** Resolve only exact, independently confirmed WSG variants. No title guesses. */
export async function matchPublishedWsgAircraft(container: string | null, span: number | null, fetcher: typeof fetch = fetch): Promise<WsgAircraftMatch | null> {
  const alias = aircraftVariantAlias(container, span);
  if (!alias) return null;
  const root = 'https://wesimglide.org/api/';
  const rules = await publicJson(root + 'GetGliderRules.php', fetcher);
  const key = exactWsgVariant(alias, rules);
  if (!key) return null;
  const [catalog, reference] = await Promise.all([
    loadPublishedWsgCatalog(fetcher),
    publicJson(root + 'GetGliderReference.php?' + new URLSearchParams({ type: alias, wingMeters: String(Math.round(span!)) }), fetcher),
  ]);
  const profile = catalog.profiles.find(p => p.variantKey.toLowerCase() === key.toLowerCase()) ?? null;
  return verifyWsgReference(key, reference, profile);
}
