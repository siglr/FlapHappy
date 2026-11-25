import {afterAll,beforeAll,expect,it} from 'vitest';
import {startEnv,type Env} from './browser-env';
let env:Env;beforeAll(async()=>{env=await startEnv();});afterAll(async()=>{expect(env.errors).toEqual([]);await env.close();});
it('global speed and altitude controls are separate from Profiles and survive a glider switch',async()=>{
 const page=await env.newPage('?seed=demo',{width:900,height:900});
 await page.click('.fh-cog');
 expect(await page.locator('.fh-pbar .fh-unitbtn').count()).toBe(0);
 await page.locator('.fh-display-settings summary').click();
 await page.getByRole('button',{name:'km/h',exact:true}).click();
 await page.getByRole('button',{name:'m',exact:true}).click();
 const select=page.locator('.fh-profile-select'),other=await select.locator('optgroup option').evaluateAll((els,current)=>els.find((e:any)=>e.value!==current)?.getAttribute('value'),await select.inputValue());
 expect(other).toBeTruthy();await select.selectOption(other!);
 expect(await page.locator('.fh-display-settings .fh-unitbtn.on').allTextContents()).toEqual(['km/h','m']);
 await page.close();
});
