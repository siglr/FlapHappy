import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import { resolveWsgAlias, verifyWsgReference, type WsgAircraftMatch } from '../../core/wsg-reference';
import { parseWsgCatalog, type WsgCatalog } from '../../core/wsg-catalog';

export const WSG_PUBLIC_CATALOG = 'https://wesimglide.org/api/flap-happy/catalog-v2.json';
const LIMIT = 262144;

/** Fixed anonymous public endpoint. No account, cookies, tokens, or user data. */
export async function loadPublishedWsgCatalog(fetcher: typeof fetch = fetch): Promise<WsgCatalog> {
  return parseWsgCatalog(await publicJson(WSG_PUBLIC_CATALOG, fetcher));
}

/** Manual selection uses an exact canonical catalog key, never a guessed alias. */
export async function loadPublishedWsgVariant(key:string,fetcher:typeof fetch=fetch):Promise<WsgAircraftMatch|null>{
  if(typeof key!=='string'||!key||key.length>100)return null;
  const catalog=await loadPublishedWsgCatalog(fetcher);
  const profile=catalog.profiles.find(p=>p.variantKey===key);
  if(!profile)return null;
  const reference=await publicJson('https://wesimglide.org/api/GetGliderReference.php?'+new URLSearchParams({type:key}),fetcher);
  return verifyWsgReference(key,reference,profile);
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
  if(typeof container!=='string'||!/^[a-zA-Z0-9_-]{1,150}$/.test(container)||container.split(/[_-]/).length<2||typeof span!=='number'||!isFinite(span)||span<5||span>40)return null;
  const root = 'https://wesimglide.org/api/';
  const rules = await publicJson(root + 'GetGliderRules.php', fetcher);
  const exact=resolveWsgAlias(container,span,rules);if(!exact)return null;
  const {alias,key}=exact;
  const [catalog, reference] = await Promise.all([
    loadPublishedWsgCatalog(fetcher),
    publicJson(root + 'GetGliderReference.php?' + new URLSearchParams({ type: alias, wingMeters: String(span) }), fetcher),
  ]);
  const profile = catalog.profiles.find(p => p.variantKey.toLowerCase() === key.toLowerCase()) ?? null;
  return verifyWsgReference(key, reference, profile);
}

/** Anonymous public-only cache. Each payload is validated before replacement
 * and again before use; an outage or malformed response retains the last good
 * data. The cache contains no local aircraft paths, profile overrides or account data. */
export class CachedWsgSource{
 private pending=new Map<string,Promise<unknown>>();
 constructor(private root:string,private fetcher:typeof fetch=fetch){}
 private get<T>(url:string,decode:(raw:unknown)=>T):Promise<T>{
  const existing=this.pending.get(url);
  if(existing)return existing.then(decode);
  const pending=this.getRaw(url,decode).finally(()=>{if(this.pending.get(url)===pending)this.pending.delete(url);});
  this.pending.set(url,pending);
  return pending.then(decode);
 }
 private async getRaw<T>(url:string,decode:(raw:unknown)=>T):Promise<unknown>{
  const file=join(this.root,createHash('sha256').update(url).digest('hex')+'.json');
  try{
   const raw=await publicJson(url,this.fetcher);decode(raw);
   try{await mkdir(this.root,{recursive:true});const temp=file+'.tmp';await writeFile(temp,JSON.stringify(raw),'utf8');await rename(temp,file);}catch{/* cache failure must not break valid online data */}
   return raw;
  }catch(error){
   try{const text=await readFile(file,'utf8');if(Buffer.byteLength(text)>LIMIT)throw Error('Oversized cache');const raw=JSON.parse(text);decode(raw);return raw;}catch{throw error;}
  }
 }
 catalog=():Promise<WsgCatalog>=>this.get(WSG_PUBLIC_CATALOG,parseWsgCatalog);
 private async reference(key:string,profile:WsgCatalog['profiles'][number]|null,type=key,span?:number):Promise<WsgAircraftMatch|null>{
  const qs=new URLSearchParams({type});if(span!==undefined)qs.set('wingMeters',String(span));
  const decode=(raw:unknown)=>{const match=verifyWsgReference(key,raw,profile);if(!match)throw Error('WSG reference failed exact mapping validation');return match;};
  return this.get('https://wesimglide.org/api/GetGliderReference.php?'+qs,decode);
 }
 variant=async(key:string):Promise<WsgAircraftMatch|null>=>{
  if(typeof key!=='string'||!key||key.length>100)return null;
  const catalog=await this.catalog();
  const profile=catalog.profiles.find(p=>p.variantKey===key);
  if(!profile)return null;
  // Canonical catalog already defines the exact mapping; without a confirmed
  // public reference the IAS geometry can use the open-ended visual fallback.
  try{return await this.reference(key,profile);}catch(e){if(e instanceof Error&&e.message==='WSG reference failed exact mapping validation')return null;return {variantKey:key,displayName:key,profile,visualVneTasKph:null};}
 };
 aircraft=async(container:string|null,span:number|null):Promise<WsgAircraftMatch|null>=>{
  if(typeof container!=='string'||!/^[a-zA-Z0-9_-]{1,150}$/.test(container)||typeof span!=='number'||!isFinite(span)||span<5||span>40)return null;
  const rules=await this.get('https://wesimglide.org/api/GetGliderRules.php',raw=>{
   const r=raw as {ok?:boolean;rules?:unknown[];gliders?:unknown[]};
   if(!r||r.ok!==true||!Array.isArray(r.rules)||!Array.isArray(r.gliders))throw Error('Invalid WSG public rules');
   return raw;
  });
  const exact=resolveWsgAlias(container,span,rules);if(!exact)return null;
  const catalog=await this.catalog();
  const profile=catalog.profiles.find(p=>p.variantKey.toLowerCase()===exact.key.toLowerCase())??null;
  return this.reference(exact.key,profile,exact.alias,span);
 };
}
