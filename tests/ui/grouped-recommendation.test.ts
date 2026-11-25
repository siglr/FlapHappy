import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {Page} from 'playwright-core';
import {startEnv,type Env} from './browser-env';
import {groupedAs33,groupedCases,lightKg} from '../fixtures/grouped-as33';
import {sample} from '../unit/helpers';
import {defaultSettings} from '../../core/settings';

let env:Env;beforeAll(async()=>{env=await startEnv();});
afterAll(async()=>{expect(env.errors).toEqual([]);await env.close();});
type Case=ReturnType<typeof groupedCases>[number];

async function assertSurface(page:Page,prefix:string,c:Case,simple:boolean){
 await page.waitForFunction(({prefix,c,simple})=>{
  const query=(s:string)=>document.querySelector(prefix+s);
  if(simple){
   const pills=[...document.querySelectorAll(prefix+'.fh-simple-pill')].filter(e=>e.getClientRects().length);
   const arrow=query('.fh-simple-arrow.on');
   return query('.fh-simple-actual')?.textContent===c.actual&&
      (c.rec===null?pills.length===0&&!arrow:pills.length===1&&pills[0].textContent===c.rec&&arrow?.classList.contains(c.direction!));
  }
  return query('.fh-cell.current')?.textContent===c.group&&(c.group===c.actual||query('.fh-badge')?.textContent===c.actual)&&
    (c.rec===null?!query('.fh-cell.recommended'):query('.fh-cell.recommended')?.textContent===c.rec);
 },{prefix,c,simple});
 if(simple){
  expect(await page.locator(prefix+'.fh-simple-row').isVisible()).toBe(true);
  expect(await page.locator(prefix+'.fh-flaps-row').isVisible()).toBe(false);
 }else{
  expect(await page.locator(prefix+'.fh-flaps-row').isVisible()).toBe(true);
  expect(await page.locator(prefix+'.fh-simple-row').isVisible()).toBe(false);
 }
}

describe('grouped recommendation renders consistently',()=>{
 for(const kind of ['native','wsg'] as const){
  it(kind+' correctly renders 102 km/h at flap 5 and neighboring grouped boundaries on both surfaces',async()=>{
   const p=groupedAs33(kind),cases=groupedCases(p);
   let current:Case=cases[0],simple=true;
   const desktop=await env.newPage('?seed=demo',{width:820,height:900});
   const cockpit=await env.browser.newPage({viewport:{width:350,height:500}});
   try{
    await desktop.evaluate(({p,c,kg})=>{const w=(window as any).__flapHappy;Object.assign(w.sim.controls,{flapCount:8,flapIndex:c.index,iasKt:c.ias,totalWeightKg:kg,connected:true,inFlight:true,onGround:false});w.sim.tick(0);w.app.setActiveProfile(p,true);w.app.setSimpleFlap(true);w.app.setHighlightRecommended(true);},{p,c:current,kg:lightKg});
    await cockpit.route('**/api/state',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ready:true,profile:p,sample:sample({flapCount:8,flapIndex:current.index,iasKt:current.ias,totalWeightKg:lightKg}),receivedAt:Date.now(),ballast:0,units:'kmh',height:'ft',agl:defaultSettings().agl,zoom:1,simpleFlap:simple,highlightRecommended:true,showTransitions:true})}));
    await cockpit.goto(env.url+'panel.html');
    for(const mode of [true,false]){
     simple=mode;
     await desktop.evaluate(v=>(window as any).__flapHappy.app.setSimpleFlap(v),simple);
     for(const c of cases){
      current=c;await desktop.evaluate(c=>{const sim=(window as any).__flapHappy.sim;Object.assign(sim.controls,{flapIndex:c.index,iasKt:c.ias});sim.tick(0);},c);
      await assertSurface(desktop,'.fh-display ',c,simple);
      await assertSurface(cockpit,'',c,simple);
     }
    }
   }finally{await desktop.close();await cockpit.close();}
  });
 }
});
