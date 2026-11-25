import { afterAll,beforeAll,expect,it } from 'vitest';
import {startEnv,type Env} from './browser-env';
import {makeProfile,sample} from '../unit/helpers';
import {defaultSettings} from '../../core/settings';
let env:Env;beforeAll(async()=>{env=await startEnv();});afterAll(async()=>{expect(env.errors).toEqual([]);await env.close();});

it('same merged groups and exact handle in desktop and cockpit',async()=>{
 const p=makeProfile(8);p.flaps.forEach((r,i)=>r.label=['L','6','5','N','4','3','2','1'][i]);
 for(const i of [0,1,4])p.transitions[i]={no_ballast_kt:null,max_ballast_kt:null,exclude_from_display:true};
 const d=await env.newPage('?seed=demo',{width:820,height:900});
 await d.evaluate(p=>{const w=(window as any).__flapHappy;w.app.setActiveProfile(p,true);w.app.setShowTransitions(true);Object.assign(w.sim.controls,{flapCount:8,flapIndex:1,iasKt:80});w.sim.tick(0);},p);
 const c=await env.browser.newPage({viewport:{width:350,height:500}});
 await c.route('**/api/state',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ready:true,profile:p,sample:sample({flapCount:8,flapIndex:1,iasKt:80}),receivedAt:Date.now(),ballast:0,units:'kt',height:'ft',agl:defaultSettings().agl,zoom:1,showTransitions:true})}));
 await c.goto(env.url+'panel.html');
 for(const [page,prefix] of [[d,'.fh-display '],[c,'']] as const){
   await page.waitForSelector(prefix+'.fh-cell.current');
   expect(await page.locator(prefix+'.fh-cell').allTextContents()).toEqual(['L-6-5','N','4-3','2','1']);
   expect(await page.locator(prefix+'.fh-cell.current').textContent()).toBe('L-6-5');
   expect(await page.locator(prefix+'.fh-badge').textContent()).toBe('6');
   expect(await page.locator(prefix+'.fh-ticktext').count()).toBe(6);
 }
 await d.click('.fh-cog');
 expect(await d.locator('.fh-exclude-transition input').first().isChecked()).toBe(true);
 await d.close();await c.close();
});
