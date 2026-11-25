import { afterAll, beforeAll, expect, it } from 'vitest';
import { startEnv, type Env } from './browser-env';
let env:Env;
beforeAll(async()=>{env=await startEnv();});
afterAll(async()=>{expect(env.errors).toEqual([]);await env.close();});
it('selected destination, managed enable/remove, conditional update and badge',async()=>{
 const page=await env.newPage('?seed=demo',{width:1000,height:1000});
 await page.evaluate(()=>{
 const a=(window as any).__flapHappy.app;
 let installed=false,older=false;
 const status=(choice:any)=>{
   if(choice.customParent==='Community')choice={kind:'community',customParent:null};
   return {destination:choice,installed,canRemove:installed,installedVersion:installed?(older?'1.0.0':'1.0.1'):null,action:installed?(older?'Update':null):'Install',message:installed?(older?'Update available':'Up to date'):'Not installed',linked:false};
 };
 a.host.panelStatus=async(c:any)=>status(c);
 a.host.browsePanelParent=async()=> 'Community';
 a.host.setPanelInstalled=async(c:any,v:boolean)=>{installed=v;older=v;return {ok:true,status:status(c)};};
 a.host.updatePanel=async(c:any)=>{older=false;return {ok:true,status:status(c)};};
 a.closeSettings();a.openSettings();
 });
 await page.getByText('Window and app',{exact:true}).click();
 const enable=page.getByRole('checkbox',{name:'Enable in-sim panel'}),dest=page.getByLabel('Panel destination'),browse=page.getByRole('button',{name:'Browse',exact:true}),update=page.getByRole('button',{name:'Update',exact:true});
 await enable.waitFor();expect(await browse.isVisible()).toBe(false);
 await dest.selectOption('custom');await browse.waitFor({state:'visible'});await browse.click();
 await page.waitForFunction(()=>document.querySelector<HTMLSelectElement>('[aria-label="Panel destination"]')?.value==='community');
 expect(await browse.isVisible()).toBe(false);
 await enable.check();await update.waitFor({state:'visible'});expect(await page.locator('.fh-cog').getAttribute('class')).toContain('fh-panel-update');
 await update.click();await update.waitFor({state:'hidden'});expect(await page.locator('.fh-cog').getAttribute('class')).not.toContain('fh-panel-update');
 await enable.uncheck();await page.waitForFunction(()=>document.querySelector('.fh-panel-install [role=status]')?.textContent==='Not installed');
 expect(await enable.isChecked()).toBe(false);await page.close();
});
