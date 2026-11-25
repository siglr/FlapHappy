import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { startEnv,type Env } from './browser-env';
let env:Env;
beforeAll(async()=>{env=await startEnv();});
afterAll(async()=>{expect(env.errors).toEqual([]);await env.close();});
const catalog={revision:16,profiles:[{variantKey:'AS33-18-GF',lightWeightKg:485,heavyWeightKg:600,lightStallIasKph:null,heavyStallIasKph:null,bands:[{label:'L',handleIndex:2,lightStartKt:0,heavyStartKt:0,excludeFromDisplay:false},{label:'N',handleIndex:1,lightStartKt:50,heavyStartKt:60,excludeFromDisplay:true},{label:'1',handleIndex:0,lightStartKt:70,heavyStartKt:80,excludeFromDisplay:false}]}]};
describe('default public WSG profile source',()=>{
 it('automatically fills the selector without opt-in, previews exact flags and weights, and never changes the active local profile',async()=>{
  const page=await env.newPage('?seed=demo',{width:1000,height:900});
  await page.evaluate(c=>{const w=window as any;w.catalogReads=0;w.__flapHappy.app.host.getPublishedWsgCatalog=async()=>{w.catalogReads++;return c;};},catalog);
  await page.click('.fh-cog');
  expect(await page.locator('.fh-wsg-enabled').count()).toBe(0);
  const local=await page.locator('.fh-profile-select').inputValue();
  await page.waitForFunction(()=>document.querySelector('option[value=":wsg:AS33-18-GF"]')!==null);
  expect(await page.evaluate(()=> (window as any).catalogReads)).toBe(1);
  await page.selectOption('.fh-profile-select',':wsg:AS33-18-GF');
  expect(await page.locator('.fh-wsg-preview').textContent()).toContain('485');
  expect(await page.locator('.fh-wsg-preview').textContent()).toContain('Not published');
  expect(await page.locator('.fh-wsg-transitions').textContent()).toContain('(Hide)');
  expect(await page.locator('.fh-settings .fh-save').isDisabled()).toBe(true);
  expect(await page.evaluate(()=> (window as any).__flapHappy.profileId())).toBe(local);
  expect(await page.evaluate(async()=> (await (window as any).__flapHappy.app.store.list()).length)).toBe(3);
  await page.click('.fh-settings .fh-back');
  await page.click('.fh-cog');
  await page.waitForFunction(()=>document.querySelector('option[value=":wsg:AS33-18-GF"]')!==null);
  expect(await page.evaluate(()=> (window as any).catalogReads)).toBe(2); // auto fetch on reopen
  expect(await page.locator('.fh-profile-select option[value=":custom"]').count()).toBe(1);
  expect(await page.locator('.fh-profile-select').inputValue()).toBe(local);
  await page.close();
 });
 it('keeps the local editor available when the public source is offline',async()=>{
  const page=await env.newPage('?seed=demo');
  await page.evaluate(()=>{(window as any).__flapHappy.app.host.getPublishedWsgCatalog=async()=>{throw Error('offline');};});
  await page.click('.fh-cog');
  await page.waitForFunction(()=>document.querySelector('.fh-wsg-status')?.textContent?.includes('unavailable'));
  expect(await page.locator('.fh-profile-select').isEnabled()).toBe(true);
  expect(await page.locator('.fh-weight-mode').isVisible()).toBe(true);
  await page.close();
 });
 it('saves sparse personal adjustments with manual ballast and restores them on reopen; reset returns to WSG defaults',async()=>{
  const page=await env.newPage('?seed=demo',{width:1000,height:900});
  await page.evaluate(c=>{(window as any).__flapHappy.app.host.getPublishedWsgCatalog=async()=>c;},catalog);
  await page.click('.fh-cog');
  await page.waitForFunction(()=>document.querySelector('option[value=":wsg:AS33-18-GF"]')!==null);
  await page.selectOption('.fh-profile-select',':wsg:AS33-18-GF');
  await page.selectOption('.fh-wsg-ballast','manual');
  await page.fill('[data-wsg-override="transition 0 Light"]','51');
  await page.selectOption('[aria-label="Transition 0 visibility"]','show');
  await page.click('.fh-wsg-save-adjustments');
  await page.waitForFunction(()=>document.querySelector('.fh-wsg-adjustment-status')?.textContent?.includes('saved locally'));
  const read=()=>page.evaluate(()=> (window as any).__flapHappy.app.settings.wsg_profile_overrides['AS33-18-GF']);
  const saved=await read(); expect(saved.ballastMode).toBe('manual');expect(saved.lightWeightKg).toBeUndefined();
  expect(Object.values(saved.transitions)[0]).toMatchObject({lightStartKt:51,excludeFromDisplay:false});
  await page.click('.fh-settings .fh-back');await page.click('.fh-cog');
  await page.waitForFunction(()=>document.querySelector('option[value=":wsg:AS33-18-GF"]')!==null);
  await page.selectOption('.fh-profile-select',':wsg:AS33-18-GF');
  expect(await page.locator('.fh-wsg-ballast').inputValue()).toBe('manual');
  expect(Number(await page.locator('[data-wsg-override="transition 0 Light"]').inputValue())).toBeCloseTo(51);
  await page.fill('[data-wsg-override="lightWeightKg"]','490');await page.click('.fh-wsg-save-adjustments');
  await page.waitForFunction(()=>document.querySelector('.fh-wsg-adjustment-status')?.textContent?.includes('Invalid curve'));
  expect(await read()).toEqual(saved);
  await page.click('.fh-wsg-reset-adjustments');
  await page.waitForFunction(()=>document.querySelector<HTMLSelectElement>('.fh-wsg-ballast')?.value==='inherit');
  expect(await read()).toBeUndefined();
  await page.close();
 });
});

it('keeps prior speed precision, rounds new edits to a tenth and asks for stall confirmation only when context changes',async()=>{
 const page=await env.newPage('?seed=demo',{width:760,height:900});
 try{
  await page.evaluate(c=>{const w=window as any,a=w.__flapHappy.app,p=c.profiles[0];a.host.getPublishedWsgCatalog=async()=>c;
   a.settings.wsg_profile_overrides[p.variantKey]={mapping:JSON.stringify(p.bands.map(b=>[b.handleIndex,b.label])),stallContext:JSON.stringify([485,600,2,'L']),lightStallIasKph:70.12345,heavyStallIasKph:78.54321,transitions:{[JSON.stringify([[2,'L'],[1,'N']])]:{lightStartKt:50.12345}}};},catalog);
  await page.click('.fh-cog');await page.waitForFunction(()=>document.querySelector('option[value=":wsg:AS33-18-GF"]')!==null);await page.selectOption('.fh-profile-select',':wsg:AS33-18-GF');
  const confirm=page.locator('.fh-confirm-stall-row'),light=page.locator('[data-wsg-override="transition 0 Light"]'),heavy=page.locator('[data-wsg-override="transition 0 Heavy"]'),vis=page.locator('[aria-label="Transition 0 visibility"]');
  expect(await confirm.isVisible()).toBe(false);expect(await light.inputValue()).toBe('50.1');
  await heavy.fill('60.456');expect(await heavy.inputValue()).toBe('60.5');
  const sameRow=await page.evaluate(()=>{const a=document.querySelector('[data-wsg-override="transition 0 Light"]')!,b=document.querySelector('[aria-label="Transition 0 visibility"]')!;return a.closest('.fh-visibility-row')===b.closest('.fh-visibility-row');});expect(sameRow).toBe(true);
  await vis.selectOption('show');expect(await confirm.isVisible()).toBe(false);await vis.selectOption('inherit');expect(await confirm.isVisible()).toBe(false);await vis.selectOption('show');
  const weight=page.locator('[data-wsg-override="lightWeightKg"]');await weight.fill('490');expect(await confirm.isVisible()).toBe(true);await weight.fill('');expect(await confirm.isVisible()).toBe(false);
  await page.click('.fh-wsg-save-adjustments');await page.waitForFunction(()=>document.querySelector('.fh-wsg-adjustment-status')?.textContent?.includes('saved locally'));
  const saved=await page.evaluate(()=> (window as any).__flapHappy.app.settings.wsg_profile_overrides['AS33-18-GF']);expect(saved.lightStallIasKph).toBe(70.12345);expect(saved.heavyStallIasKph).toBe(78.54321);expect(saved.stallContext).toBe(JSON.stringify([485,600,2,'L']));expect(Object.values(saved.transitions)[0]).toMatchObject({lightStartKt:50.12345,heavyStartKt:60.5});
  expect(await confirm.isVisible()).toBe(false);
  await page.evaluate(()=>{const a=(window as any).__flapHappy.app;a.settings.wsg_profile_overrides['AS33-18-GF'].stallContext=JSON.stringify([485,600,1,'N']);});
  await page.selectOption('.fh-profile-select','as33-18m');await page.selectOption('.fh-profile-select',':wsg:AS33-18-GF');await confirm.waitFor();await page.locator('.fh-confirm-stall-context').check();await page.click('.fh-wsg-save-adjustments');await page.waitForFunction(()=>document.querySelector('.fh-wsg-adjustment-status')?.textContent?.includes('saved locally'));expect(await confirm.isVisible()).toBe(false);
  await page.setViewportSize({width:430,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await page.close();}
});

it('keeps edited metric tenths and exact untouched knot overrides across save/reopen',async()=>{
 const page=await env.newPage('?seed=demo',{width:760,height:850});try{
  await page.evaluate(c=>{const a=(window as any).__flapHappy.app;a.setSpeedUnit('kmh');a.host.getPublishedWsgCatalog=async()=>c;const p=c.profiles[0];a.settings.wsg_profile_overrides[p.variantKey]={mapping:JSON.stringify(p.bands.map(b=>[b.handleIndex,b.label])),transitions:{[JSON.stringify([[2,'L'],[1,'N']])]:{heavyStartKt:60.123456}}};},catalog);
  await page.click('.fh-cog');await page.waitForFunction(()=>document.querySelector('option[value=":wsg:AS33-18-GF"]')!==null);await page.selectOption('.fh-profile-select',':wsg:AS33-18-GF');
  const light=page.locator('[data-wsg-override="transition 0 Light"]');await light.fill('94.567');expect(await light.inputValue()).toBe('94.6');await page.click('.fh-wsg-save-adjustments');await page.waitForFunction(()=>document.querySelector('.fh-wsg-adjustment-status')?.textContent?.includes('saved locally'));
  const saved=await page.evaluate(()=>Object.values((window as any).__flapHappy.app.settings.wsg_profile_overrides['AS33-18-GF'].transitions)[0]);expect(saved).toMatchObject({lightStartKt:94.6/1.852,heavyStartKt:60.123456});expect(await light.inputValue()).toBe('94.6');
 }finally{await page.close();}
});

it('the complete WSG default (Show) label fits including dropdown arrow at default and scaled/narrow widths',async()=>{
 const page=await env.newPage('?seed=demo',{width:760,height:850});try{
  await page.evaluate(c=>{(window as any).__flapHappy.app.host.getPublishedWsgCatalog=async()=>c;},catalog);
  await page.click('.fh-cog');await page.waitForFunction(()=>document.querySelector('option[value=":wsg:AS33-18-GF"]')!==null);await page.selectOption('.fh-profile-select',':wsg:AS33-18-GF');
  for(const width of [760,506,400]){await page.setViewportSize({width,height:850});const measured=await page.locator('[aria-label="Transition 1 visibility"]').evaluate(el=>{const sel=el as HTMLSelectElement,style=getComputedStyle(sel),ctx=document.createElement('canvas').getContext('2d')!;ctx.font=style.font;return {label:sel.selectedOptions[0].textContent,available:sel.clientWidth,needed:ctx.measureText(sel.selectedOptions[0].textContent??'').width+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+24};});expect(measured.label).toBe('WSG default (Show)');expect(measured.available).toBeGreaterThanOrEqual(measured.needed);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 }finally{await page.close();}
});
