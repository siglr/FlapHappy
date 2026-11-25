import { afterAll,beforeAll,expect,it } from 'vitest';
import {startEnv,type Env} from './browser-env';
import {makeProfile,sample} from '../unit/helpers';
import {defaultSettings} from '../../core/settings';
let env:Env;beforeAll(async()=>{env=await startEnv();});afterAll(async()=>{expect(env.errors).toEqual([]);await env.close();});

it('switches between one and two non-overlapping lanes in both renderers',async()=>{
 const wide=makeProfile(3);const dense=makeProfile(6);
 dense.vne=160;dense.transitions.forEach((t,i)=>{t.no_ballast_kt=[60,62,64,90,110][i];t.max_ballast_kt=[65,67,69,95,115][i];});
 const desktop=await env.newPage('?seed=demo',{width:820,height:900});
 const load=async(p:typeof wide)=>desktop.evaluate(p=>{const w=(window as any).__flapHappy;w.app.setActiveProfile(p,true);w.app.setShowTransitions(true);Object.assign(w.sim.controls,{flapCount:p.flaps.length,flapIndex:0,totalWeightKg:400});w.sim.tick(0);},p);
 let current=wide;
 const cockpit=await env.browser.newPage({viewport:{width:500,height:500}});
 await cockpit.route('**/api/state',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ready:true,profile:current,sample:sample({flapCount:current.flaps.length}),receivedAt:Date.now(),ballast:0,units:'kt',height:'ft',agl:defaultSettings().agl,zoom:1,showTransitions:true})}));
 await cockpit.goto(env.url+'panel.html');await load(wide);
 async function check(page:any,prefix:string,lanes:number){
  await page.waitForFunction(({prefix,lanes}:any)=>document.querySelector(prefix+'.fh-ticklabels')?.getAttribute('data-lanes')===String(lanes),{prefix,lanes});
  await page.waitForTimeout(200);
  const bounds=await page.locator(prefix+'.fh-ticktext').evaluateAll((els:Element[])=>els.filter(e=>getComputedStyle(e).visibility!=='hidden').map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,l:r.left,r:r.right,y:r.top};}));
  expect(bounds.length).toBeGreaterThan(2);expect(bounds.every((x:any)=>/^\d+$/.test(x.text))).toBe(true);
  for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++)if(Math.abs(bounds[i].y-bounds[j].y)<1)expect(bounds[i].r).toBeLessThanOrEqual(bounds[j].l+0.5);
 }
 await check(desktop,'.fh-display ',1);await check(cockpit,'',1);
 current=dense;await load(dense);await desktop.setViewportSize({width:350,height:900});await cockpit.setViewportSize({width:350,height:500});
 await check(desktop,'.fh-display ',2);await check(cockpit,'',2);
 current=wide;await load(wide);await desktop.setViewportSize({width:820,height:900});await cockpit.setViewportSize({width:820,height:500});
 await check(desktop,'.fh-display ',1);await check(cockpit,'',1);
 await desktop.close();await cockpit.close();
});
