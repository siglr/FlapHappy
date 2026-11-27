import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,readdirSync,readFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileProfileStore} from '../../adapters/electron/file-store';
import {CachedWsgSource} from '../../adapters/electron/wsg-catalog-source';
import {makeProfile,sample} from './helpers';
import {DEMO_EXAMPLES,PRESETS} from '../../profiles';
import snapshot from '../../profiles/demo-wsg-snapshot.json';
import {parseWsgCatalog} from '../../core/wsg-catalog';
import {validateProfile} from '../../core/validate';
import {wsgBoundaries} from '../../core/wsg-flight';
import {PanelRuntime} from '../../app-electron/panel-runtime';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function temp(){const r=mkdtempSync(join(tmpdir(),'fh-wsg-qa-'));roots.push(r);return r;}
it('fresh Live has no seeded defaults; Demo examples are virtual and old user files survive',async()=>{
 const store=new FileProfileStore(temp());expect(await store.list()).toEqual([]);
 const p=makeProfile(3,{id:'js3'});p.notes='pilot edits';await store.save(p);
 store.setDemoExamples(true);
 expect((await store.list()).map(p=>p.id).sort()).toEqual(['demo-as33-15m','demo-as33-18m','demo-js3','js3']);
 expect(readdirSync(store.profilesDir)).toEqual(['js3.json']);
 expect((await store.load('demo-js3')).source).toBe('preset');
 store.setDemoExamples(false);
 expect((await store.list()).map(p=>p.id)).toEqual(['js3']);
 expect((await store.load('js3')).notes).toBe('pilot edits');
});
it('catalog cache accepts only valid public data and preserves last good catalog during outage and restart',async()=>{
 const root=temp(),raw={schema:'wsg.flaphappy.catalog/2',revision:16,profiles:[]};let state='valid';
 const fetcher=async()=>{if(state==='offline')throw Error('offline');return new Response(JSON.stringify(state==='valid'?raw:{schema:'bad'}),{headers:{'content-type':'application/json'}});};
 const a=new CachedWsgSource(root,fetcher as typeof fetch);
 expect((await a.catalog()).revision).toBe(16);state='invalid';expect((await a.catalog()).revision).toBe(16);
 state='offline';expect((await new CachedWsgSource(root,fetcher as typeof fetch).catalog()).revision).toBe(16);
 await expect(new CachedWsgSource(temp(),fetcher as typeof fetch).catalog()).rejects.toThrow('offline');
});

it('manual CalVR selection uses exact public alias if canonical key reference resolves to a different add-on',async()=>{
 const key='JS3-18-BC';
 const bands=[{label:'L',handleIndex:1,lightStartKt:0,heavyStartKt:0,excludeFromDisplay:false},{label:'1',handleIndex:0,lightStartKt:60,heavyStartKt:70,excludeFromDisplay:false}];
 const catalog={schema:'wsg.flaphappy.catalog/2',revision:16,profiles:[{schema:'wsg.flaphappy.profile/1',variantKey:key,lightWeightKg:400,heavyWeightKg:600,handleCount:2,bands}]};
 const rules={ok:true,rules:[{RuleType:'EXACT',Pattern:'bc_js3_18m',GliderKey:key}],gliders:[{GliderKey:key}]};
 const ref=(k:string)=>({ok:true,schemaVersion:1,status:'matched',glider:{gliderKey:k,hasFlaps:true,flapCount:2,flapLabels:{'1':'1','2':'L'},vneTasKph:292}});
 const fetcher=async(input:string|URL|Request)=>{const u=new URL(String(input));const raw=u.pathname.includes('catalog')?catalog:u.pathname.includes('Rules')?rules:u.searchParams.get('type')==='bc_js3_18m'?ref(key):ref('JS3-18-MD');return new Response(JSON.stringify(raw),{headers:{'content-type':'application/json'}});};
 const source=new CachedWsgSource(temp(),fetcher as typeof fetch);
 expect(await source.variant(key)).toMatchObject({variantKey:key,visualVneTasKph:292});
});

it('upgrades old auto-seeded user profiles, including an unchanged starter and an explicit aircraft assignment, without reseeding or writing Demo files',async()=>{
 const root=temp(),prior=new FileProfileStore(root);
 // Both old desktop init and old panel runtime saved every absent PRESETS entry
 // with source=user. The three profile definitions themselves have not changed.
 for(const preset of PRESETS)await prior.save({...preset.profile,source:'user'});
 const changed=await prior.load('as33-18m');changed.notes='pilot edits';await prior.save(changed);
 renameSync(join(prior.profilesDir,'js3.json'),join(root,'intentionally-absent-js3.json'));
 const title='Assigned aircraft';const settings=await prior.getSettings();
 settings.active_by_title[title]=changed.id;settings.last_profile_id=changed.id;await prior.setSettings(settings);
 const names=['as33-15m.json','as33-18m.json'];
 const snapshot=()=>names.map(name=>readFileSync(join(prior.profilesDir,name),'utf8'));
 const before=snapshot();
 const assertPreserved=async(store:FileProfileStore)=>{
  expect(readdirSync(store.profilesDir).filter(name=>name.endsWith('.json')).sort()).toEqual(names);
  expect(snapshot()).toEqual(before);
  expect((await store.getSettings()).active_by_title[title]).toBe(changed.id);
 };
 for(let i=0;i<2;i++){
  const store=new FileProfileStore(root),lookup=vi.fn(async()=>null);
  const runtime=new PanelRuntime(store,()=>{},()=>{},lookup,undefined,'simconnect');
  await runtime.initialize();expect(runtime.getState().profile).toBeNull();
  expect((await store.list()).map(p=>[p.id,p.source])).toEqual([['as33-15m','user'],['as33-18m','user']]);
  runtime.sample(sample({aircraftTitle:title,aircraftContainer:'qa_upgrade_aircraft',wingSpanM:18,flapCount:8}),1000);
  await vi.waitFor(()=>expect(runtime.getState()).toMatchObject({ready:true,profileSource:'assigned',profile:{id:changed.id,notes:'pilot edits'}}));
  expect(lookup).not.toHaveBeenCalled();await runtime.flush();await assertPreserved(store);
 }
 const demoStore=new FileProfileStore(root),demo=new PanelRuntime(demoStore,()=>{},()=>{},undefined,undefined,'simulated');
 await demo.initialize();
 expect((await demoStore.list()).map(p=>p.id).sort()).toEqual(['as33-15m','as33-18m','demo-as33-15m','demo-as33-18m','demo-js3']);
 const demoSettings=await demo.settings();demoSettings.profile_selection={mode:'manual',manualId:'demo-js3',fallbackId:null};
 await demo.updateSettings(demoSettings);
 expect(demo.getState()).toMatchObject({profile:{id:'demo-js3',source:'preset'}});
 await demo.flush();await assertPreserved(demoStore);
});

it('deletes a saved local profile and only its references, preserving a recovery copy and virtual examples',async()=>{
 const root=temp(),store=new FileProfileStore(root);
 const target=makeProfile(3,{id:'demo-as33-18m'}),other=makeProfile(2,{id:'other'});
 await store.save(target);await store.save(other);
 const settings=await store.getSettings();settings.last_profile_id=target.id;settings.profile_selection={mode:'manual',manualId:target.id,fallbackId:target.id};settings.active_by_title={one:target.id,two:other.id};settings.ballast_by_profile={[target.id]:.3,[other.id]:.7};await store.setSettings(settings);
 const runtime=new PanelRuntime(store,()=>{},()=>{},undefined,undefined,'simulated');await runtime.initialize();
 expect((await store.list()).find(m=>m.id===target.id)?.virtual).toBeUndefined();
 await expect(runtime.removeLocalProfile('demo-js3')).rejects.toThrow('Only saved local');
 await expect(runtime.removeLocalProfile('WSG:OTHER')).rejects.toThrow('Invalid local');
 await runtime.removeLocalProfile(target.id);
 const after=await runtime.settings();expect(after.profile_selection).toEqual({mode:'manual',manualId:null,fallbackId:null});expect(after.active_by_title).toEqual({two:other.id});expect(after.ballast_by_profile).toEqual({[other.id]:.7});expect(after.last_profile_id).toBeNull();
 expect(runtime.getState().profile).toBeNull();expect((await store.list()).find(m=>m.id===target.id)?.virtual).toBe(true);
 expect(readdirSync(store.profilesDir).sort()).toEqual([target.id+'.json.deleted.bak','other.json']);
});


it('offline Demo snapshots reproduce exact published variant, speeds and TAS visual endpoints without personal files or WSG defaults',async()=>{
 const store=new FileProfileStore(temp());store.setDemoExamples(true);
 const catalog=parseWsgCatalog(snapshot.catalog);expect(catalog.revision).toBe(27);
 const expected=[['demo-as33-15m','AS33-15-GF',475,550,282,8],['demo-as33-18m','AS33-18-GF',485,600,282,8],['demo-js3','JS3-18-BC',378,600,292,6]] as const;
 for(const [id,key,light,heavy,vne,n] of expected){
  const p=await store.load(id),w=catalog.profiles.find(p=>p.variantKey===key)!;
  expect(p.id).toBe(id);expect(p.source).toBe('preset');expect(p.notes).toContain('revision 27');
  expect(p.handle_count).toBe(n);expect(p.weight_kg).toEqual({light,heavy});expect(p.vne).toBeNull();
  expect(p.wsg).toEqual({variantKey:key,hiddenTransitions:w.bands.slice(1).map(b=>b.excludeFromDisplay),visualMaxKt:vne/1.852,ballastMode:'live'});
  expect(p.flaps).toEqual(w.bands.map(b=>({label:b.label,handle_index:b.handleIndex})));
  expect(p.vs_min).toEqual({no_ballast_kt:w.lightStallIasKph!/1.852,max_ballast_kt:w.heavyStallIasKph!/1.852});
  expect(p.transitions).toEqual(w.bands.slice(1).map(b=>({no_ballast_kt:b.lightStartKt,max_ballast_kt:b.heavyStartKt})));
  expect(validateProfile(p,{liveHandleCount:n}).ok).toBe(true);
  for(const f of [0,1]){const bounds=wsgBoundaries(p,f)!;expect(bounds.at(-1)).toBe(vne/1.852);expect(bounds[0]).toBe((f?w.heavyStallIasKph!:w.lightStallIasKph!)/1.852);}
 }
 expect(DEMO_EXAMPLES).toHaveLength(3);expect(readdirSync(store.profilesDir)).toEqual([]);
 store.setDemoExamples(false);expect(await store.list()).toEqual([]);
});
