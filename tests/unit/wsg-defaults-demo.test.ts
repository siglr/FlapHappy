import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,readdirSync,readFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileProfileStore} from '../../adapters/electron/file-store';
import {CachedWsgSource} from '../../adapters/electron/wsg-catalog-source';
import {makeProfile,sample} from './helpers';
import {PRESETS} from '../../profiles';
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
