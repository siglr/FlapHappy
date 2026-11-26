import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {Page} from 'playwright-core';
import {startEnv,type Env} from './browser-env';
import {groupedAs33,groupedCases,lightKg,lowerBoundCases} from '../fixtures/grouped-as33';
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
    await desktop.evaluate(({p,c,kg})=>{const w=(window as any).__flapHappy;Object.assign(w.sim.controls,{flapCount:8,flapIndex:c.index,iasKt:c.ias,totalWeightKg:kg,connected:true,inFlight:true,onGround:false});w.sim.tick(0);w.app.setActiveProfile(p,true);w.app.setGroupHiddenFlapLabels(true);w.app.setSimpleFlap(true);w.app.setHighlightRecommended(true);},{p,c:current,kg:lightKg});
    await cockpit.route('**/api/state',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ready:true,profile:p,sample:sample({flapCount:8,flapIndex:current.index,iasKt:current.ias,totalWeightKg:lightKg}),receivedAt:Date.now(),ballast:0,units:'kmh',height:'ft',agl:defaultSettings().agl,zoom:1,simpleFlap:simple,highlightRecommended:true,showTransitions:true,groupHiddenFlapLabels:true})}));
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


describe('low IAS guidance on both renderer paths',()=>{
 for(const kind of ['native','wsg'] as const)for(const stall of [true,false])for(const showGroup of [true,false]){
  it(`${kind}, ${stall?'stall IAS':'visual-only floor'}, labels ${showGroup}`,async()=>{
   const {p,floor}=lowerBoundCases(kind,stall);
   let ias=floor-0.1,index=3,simple=false,highlight=true;
   const desktop=await env.newPage('?seed=demo',{width:820,height:900});
   const cockpit=await env.browser.newPage({viewport:{width:350,height:500}});
   try{
    await desktop.evaluate(({p,ias,kg,showGroup})=>{const w=(window as any).__flapHappy;w.app.setActiveProfile(p,true);w.app.setGroupHiddenFlapLabels(showGroup);Object.assign(w.sim.controls,{flapCount:8,flapIndex:3,iasKt:ias,totalWeightKg:kg,connected:true,inFlight:true,onGround:false});w.sim.tick(0);w.app.setSimpleFlap(false);w.app.setHighlightRecommended(true);},{p,ias,kg:lightKg,showGroup});
    await cockpit.route('**/api/state',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ready:true,profile:p,sample:sample({flapCount:8,flapIndex:index,iasKt:ias,totalWeightKg:lightKg}),receivedAt:Date.now(),ballast:0,units:'kt',height:'ft',agl:defaultSettings().agl,zoom:1,simpleFlap:simple,highlightRecommended:highlight,showTransitions:true,groupHiddenFlapLabels:showGroup})}));
    await cockpit.goto(env.url+'panel.html');
    for(const mode of [false,true]){
     simple=mode;await desktop.evaluate(v=>(window as any).__flapHappy.app.setSimpleFlap(v),simple);
     for(const [offset,handle,show] of [[-0.1,3,true],[0.1,3,true],[-0.1,5,true],[-0.1,3,false],[25-floor,3,true],[24.5-floor,3,true],[19-floor,3,true],[-floor,3,true],[-floor,5,true],[-floor,3,false]] as const){
      ias=floor+offset;index=handle;highlight=show;
      await desktop.evaluate(({ias,index,highlight})=>{const w=(window as any).__flapHappy;w.app.setHighlightRecommended(highlight);Object.assign(w.sim.controls,{flapIndex:index,iasKt:ias});w.sim.tick(0);},{ias,index,highlight});
      for(const [page,prefix] of [[desktop,'.fh-display '],[cockpit,'']] as const){
       const rec=index===3&&(simple||highlight);const group=showGroup?(kind==='wsg'?'L\u20136\u20135':'L-6-5'):'5';
       await page.waitForFunction(({prefix,simple,index,rec,low,group})=>{
        const q=(s:string)=>document.querySelector(prefix+s);
        if(simple)return q('.fh-simple-actual')?.textContent===(index===3?'4':'5')&&(rec?q('.fh-simple-pill')?.textContent===group&&q('.fh-simple-arrow.on')?.classList.contains('slower'):![...document.querySelectorAll(prefix+'.fh-simple-pill')].some(e=>e.getClientRects().length));
        return q('.fh-cell.current')?.textContent===(index===3?'4':group)&&(rec?q('.fh-cell.recommended')?.textContent===group:!q('.fh-cell.recommended'))&&q('.fh-readout')?.classList.contains('low')===low;
       },{prefix,simple,index,rec,low:stall&&offset<0&&ias>=25,group});
      }
     }
    }
   }finally{await desktop.close();await cockpit.close();}
  },45000);
 }
});
