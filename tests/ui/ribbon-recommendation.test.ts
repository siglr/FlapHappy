import { afterAll,beforeAll,expect,it } from 'vitest';
import {startEnv,type Env} from './browser-env';
import {makeProfile,sample} from '../unit/helpers';
import {defaultSettings} from '../../core/settings';
let env:Env;beforeAll(async()=>{env=await startEnv();});afterAll(async()=>{expect(env.errors).toEqual([]);await env.close();});

it('keeps actual blue, optionally highlights different suggestion and clears on ground in both renderers',async()=>{
 const p=makeProfile(6);let show=false,ias=95,ground=false;
 const d=await env.newPage('?seed=demo',{width:820,height:900});
 await d.evaluate(p=>{const w=(window as any).__flapHappy;w.app.setActiveProfile(p,true);w.app.setBallast(0);Object.assign(w.sim.controls,{flapCount:6,flapIndex:2,iasKt:95,onGround:false,connected:true,inFlight:true});w.sim.tick(0);},p);
 const c=await env.browser.newPage({viewport:{width:350,height:500}});
 await c.route('**/api/state',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ready:true,profile:p,sample:sample({flapCount:6,flapIndex:2,iasKt:ias,onGround:ground}),receivedAt:Date.now(),ballast:0,units:'kt',height:'ft',agl:defaultSettings().agl,zoom:1,highlightRecommended:show})}));
 await c.goto(env.url+'panel.html');await c.waitForSelector('.fh-cell.current');
 expect(await d.locator('.fh-display .fh-cell.recommended').count()).toBe(0);expect(await c.locator('.fh-cell.recommended').count()).toBe(0);
 await d.click('.fh-cog');await d.locator('.fh-highlight-recommended').evaluate((e:HTMLInputElement)=>e.click());await d.click('.fh-back');show=true;
 for(const [page,prefix] of [[d,'.fh-display '],[c,'']] as const){
   await page.waitForSelector(prefix+'.fh-cell.recommended');expect(await page.locator(prefix+'.fh-cell.recommended').textContent()).toBe('5');
   expect(await page.locator(prefix+'.fh-cell.current').textContent()).toBe('3');
   await page.waitForTimeout(200);
   const colors=await page.locator(prefix+'.fh-cell').evaluateAll(els=>els.filter(e=>e.classList.contains('current')||e.classList.contains('recommended')).map(e=>getComputedStyle(e).backgroundColor));
   expect(colors).toEqual(['rgb(47, 143, 216)','rgb(255, 218, 145)']);
 }
 await d.evaluate(()=>{const s=(window as any).__flapHappy.sim;s.controls.iasKt=70;s.tick(0);});ias=70;
 await d.waitForTimeout(350);await c.waitForTimeout(350);
 expect(await d.locator('.fh-display .fh-cell.recommended').count()).toBe(0);expect(await c.locator('.fh-cell.recommended').count()).toBe(0);
 await d.close();await c.close();
});
