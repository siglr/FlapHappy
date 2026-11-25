import { parseWsgCatalog, type WsgCatalog } from '../../core/wsg-catalog';

export const WSG_PUBLIC_CATALOG = 'https://wesimglide.org/api/flap-happy/catalog-v2.json';
const LIMIT = 262144;

/** Fixed anonymous public endpoint. No account, cookies, tokens, or user data. */
export async function loadPublishedWsgCatalog(fetcher: typeof fetch = fetch): Promise<WsgCatalog> {
  const response = await fetcher(WSG_PUBLIC_CATALOG, { method: 'GET', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
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
  return parseWsgCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
