import { describe, expect, it, vi } from 'vitest';
import { parseWsgCatalog } from '../../core/wsg-catalog';
import { loadPublishedWsgCatalog, matchPublishedWsgAircraft, WSG_PUBLIC_CATALOG } from '../../adapters/electron/wsg-catalog-source';
import { aircraftContainer, aircraftVariantAlias, exactWsgVariant } from '../../core/wsg-reference';
import { selectLiveProfileId } from '../../core/select';
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
  it('resolves only literal unambiguous container-and-span aliases and confirms the public ordered reference', async () => {
    expect(aircraftContainer('C:/sim/SimObjects/Airplanes/publisher_model/aircraft.cfg')).toBe('publisher_model');
    expect(aircraftContainer('C:/unrelated/aircraft.cfg')).toBeNull();
    expect(aircraftVariantAlias('AS33',18)).toBeNull();
    expect(aircraftVariantAlias('publisher_model_15m',18)).toBeNull();
    expect(aircraftVariantAlias('publisher_model',18)).toBe('publisher_model_18m');
    const rules={ok:true, rules:[{RuleType:'REGEX',Pattern:'^publisher_model_18m',GliderKey:'AS33-18-TEST'}],gliders:[{GliderKey:'AS33-18-TEST'}]};
    expect(exactWsgVariant('publisher_model_18m',rules)).toBe('AS33-18-TEST');
    expect(exactWsgVariant('publisher_model_18m-other',rules)).toBeNull();
    expect(exactWsgVariant('publisher_model_18m',{...rules,rules:[...rules.rules,{RuleType:'EXACT',Pattern:'publisher_model_18m',GliderKey:'OTHER'}]})).toBeNull();
    const ref={ok:true,schemaVersion:1,status:'matched',glider:{gliderKey:'AS33-18-TEST',displayName:'Test variant',hasFlaps:true,flapCount:3,flapLabels:{'1':'1','2':'N','3':'L'}}};
    const mock = vi.fn(async (url:string) => new Response(JSON.stringify(url.includes('GetGliderRules')?rules:url.includes('GetGliderReference')?ref:fixture()),{headers:{'content-type':'application/json'}}));
    expect((await matchPublishedWsgAircraft('publisher_model',18,mock as unknown as typeof fetch))?.profile?.variantKey).toBe('AS33-18-TEST');
    expect(mock.mock.calls.every(([url])=>!url.includes('TITLE')&&!url.includes('aircraft.cfg'))).toBe(true);
    const before=mock.mock.calls.length;
    expect(await matchPublishedWsgAircraft('AS33',18,mock as unknown as typeof fetch)).toBeNull();
    expect(mock.mock.calls.length).toBe(before);
    ref.glider.flapLabels['2']='wrong';
    expect(await matchPublishedWsgAircraft('publisher_model',18,mock as unknown as typeof fetch)).toBeNull();
  });
  it('never reuses the last local profile for an unmatched or ambiguous live title', () => {
    const metas = [{id:'a',match:['Model A'],incomplete:false},{id:'b',match:['both'],incomplete:false},{id:'c',match:['both'],incomplete:false}] as any;
    const st=defaultSettings(); st.last_profile_id='a';
    expect(selectLiveProfileId(metas,st,'Unknown')).toBeNull();
    expect(selectLiveProfileId(metas,st,'Model A')).toBe('a');
    expect(selectLiveProfileId(metas,st,'both')).toBeNull();
    st.active_by_title['Unknown']='b';
    expect(selectLiveProfileId(metas,st,'Unknown')).toBe('b');
  });

});
