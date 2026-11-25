import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileProfileStore} from '../../adapters/electron/file-store';
import {CachedWsgSource} from '../../adapters/electron/wsg-catalog-source';
import {makeProfile} from './helpers';
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
