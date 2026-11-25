import { describe, expect, it, vi } from 'vitest';
import { parseWsgCatalog } from '../../core/wsg-catalog';
import { loadPublishedWsgCatalog, WSG_PUBLIC_CATALOG } from '../../adapters/electron/wsg-catalog-source';
import { defaultSettings, normalizeSettings } from '../../core/settings';

const fixture = () => ({schema:'wsg.flaphappy.catalog/2', revision:4, profiles:[{
  schema:'wsg.flaphappy.profile/1',variantKey:'AS33-18-TEST',handleCount:3,lightWeightKg:400,heavyWeightKg:600,
  bands:[{label:'L',handleIndex:2,lightStartKt:0,heavyStartKt:0},{label:'N',handleIndex:1,lightStartKt:50,heavyStartKt:60,excludeFromDisplay:true},{label:'1',handleIndex:0,lightStartKt:70,heavyStartKt:80}]
}]});
describe('anonymous published WSG source', () => {
  it('keeps exact ordered native mapping, weights, exclusion and null stall values separate from local profiles', () => {
    const row = parseWsgCatalog(fixture()).profiles[0];
    expect(row.variantKey).toBe('AS33-18-TEST');
    expect(row.lightWeightKg).toBe(400); expect(row.heavyWeightKg).toBe(600);
    expect(row.lightStallIasKph).toBeNull(); expect(row.heavyStallIasKph).toBeNull();
    expect(row.bands.map(b=>[b.label,b.handleIndex,b.excludeFromDisplay])).toEqual([['L',2,false],['N',1,true],['1',0,false]]);
  });
  it('rejects malformed anchors, duplicate mappings, flags, schema and speed order', () => {
    const bad = [
      (d:any)=>{d.profiles[0].lightWeightKg=null;}, (d:any)=>{d.profiles[0].heavyWeightKg=400;},
      (d:any)=>{d.profiles[0].bands[1].handleIndex=2;}, (d:any)=>{d.profiles[0].bands[1].excludeFromDisplay='true';},
      (d:any)=>{d.profiles[0].bands[2].lightStartKt=49;}, (d:any)=>{d.profiles[0].lightStallIasKph=40;},
      (d:any)=>{d.schema='other';}, (d:any)=>{d.profiles.push(d.profiles[0]);}
    ];
    for (const change of bad) {const d=fixture(); change(d); expect(()=>parseWsgCatalog(d)).toThrow();}
  });
  it('uses a fixed public anonymous GET and refuses an oversized or non-JSON payload', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify(fixture()),{headers:{'content-type':'application/json'}}));
    expect((await loadPublishedWsgCatalog(mock as unknown as typeof fetch)).revision).toBe(4);
    expect(mock).toHaveBeenCalledWith(WSG_PUBLIC_CATALOG, expect.objectContaining({method:'GET',credentials:'omit',redirect:'error',headers:{Accept:'application/json'}}));
    const huge = async () => new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}});
    await expect(loadPublishedWsgCatalog(huge as typeof fetch)).rejects.toThrow('too large');
    await expect(loadPublishedWsgCatalog((async()=>new Response('not json')) as typeof fetch)).rejects.toThrow();
  });
  it('defaults to local-only and persists only explicit opt-in', () => {
    expect(defaultSettings().wsg_profiles_enabled).toBe(false);
    expect(normalizeSettings({schema:'flaphappy.settings/1',wsg_profiles_enabled:true}).wsg_profiles_enabled).toBe(true);
    expect(normalizeSettings({schema:'flaphappy.settings/1',wsg_profiles_enabled:'true'}).wsg_profiles_enabled).toBe(false);
  });
});
