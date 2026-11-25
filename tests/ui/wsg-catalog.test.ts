import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { startEnv,type Env } from './browser-env';
let env:Env;
beforeAll(async()=>{env=await startEnv();});
afterAll(async()=>{expect(env.errors).toEqual([]);await env.close();});
const catalog={revision:16,profiles:[{variantKey:'AS33-18-GF',lightWeightKg:485,heavyWeightKg:600,lightStallIasKph:null,heavyStallIasKph:null,bands:[{label:'L',handleIndex:2,lightStartKt:0,heavyStartKt:0,excludeFromDisplay:false},{label:'N',handleIndex:1,lightStartKt:50,heavyStartKt:60,excludeFromDisplay:true},{label:'1',handleIndex:0,lightStartKt:70,heavyStartKt:80,excludeFromDisplay:false}]}]};
describe('optional WSG profile source',()=>{
 it('automatically fills the selector on opt-in, previews exact flags and weights, and never changes the active local profile',async()=>{
  const page=await env.newPage('?seed=demo',{width:1000,height:900});
  await page.evaluate(c=>{const w=window as any;w.catalogReads=0;w.__flapHappy.app.host.getPublishedWsgCatalog=async()=>{w.catalogReads++;return c;};},catalog);
  await page.click('.fh-cog');
  expect(await page.locator('.fh-wsg-enabled').isChecked()).toBe(false);
  expect(await page.evaluate(()=> (window as any).catalogReads)).toBe(0);
  const local=await page.locator('.fh-profile-select').inputValue();
  await page.check('.fh-wsg-enabled');
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
  expect(await page.evaluate(()=> (window as any).catalogReads)).toBe(2); // remembered opt-in, auto fetch on reopen
  await page.uncheck('.fh-wsg-enabled');
  expect(await page.locator('.fh-profile-select option[value=":wsg:AS33-18-GF"]').count()).toBe(0);
  expect(await page.locator('.fh-profile-select option[value=":custom"]').count()).toBe(1);
  expect(await page.locator('.fh-profile-select').inputValue()).toBe(local);
  await page.close();
 });
 it('keeps the local editor available when the public source is offline',async()=>{
  const page=await env.newPage('?seed=demo');
  await page.evaluate(()=>{(window as any).__flapHappy.app.host.getPublishedWsgCatalog=async()=>{throw Error('offline');};});
  await page.click('.fh-cog'); await page.check('.fh-wsg-enabled');
  await page.waitForFunction(()=>document.querySelector('.fh-wsg-status')?.textContent?.includes('unavailable'));
  expect(await page.locator('.fh-profile-select').isEnabled()).toBe(true);
  expect(await page.locator('.fh-weight-mode').isVisible()).toBe(true);
  await page.close();
 });
});
