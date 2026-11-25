import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {startEnv,type Env} from './browser-env';
let env:Env;beforeAll(async()=>{env=await startEnv();});afterAll(async()=>{expect(env.errors).toEqual([]);await env.close();});
const base='panel/flaphappy-ingamepanel/html_ui/InGamePanels/FlapHappy/';
describe('actual toolbar wrapper with mocked MSFS camera',()=>{
 it('hides and restores without unloading the iframe, keeps known preference on a failed request, ignores unknown state',async()=>{
  const page=await env.newPage('?seed=none');
  await page.route('http://127.0.0.1:47321/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body>Fixture panel</body></html>'}));
  await page.setContent('<flaphappy-ingamepanel><ingame-ui id="FlapHappyPanel"><div id="FlapHappyWrap"><div id="FlapHappyNote"></div><iframe id="FlapHappyFrame"></iframe></div></ingame-ui></flaphappy-ingamepanel>');
  await page.addStyleTag({content:readFileSync(base+'FlapHappy.css','utf8')});
  await page.evaluate(()=>{
    const w=window as any;w.mockCamera=2;w.mockPreference=true;w.mockFailure=false;
    w.TemplateElement=class extends HTMLElement{connectedCallback(){}disconnectedCallback(){}};w.checkAutoload=()=>{};
    w.SimVar={IsReady:()=>true,GetSimVarValue:()=>w.mockCamera};
    w.XMLHttpRequest=class {url='';readyState=0;status=0;responseText='';onreadystatechange?:()=>void;open(_method:string,url:string){this.url=url;}send(){setTimeout(()=>{this.status=this.url.includes('panel-settings')&&w.mockFailure?503:200;this.responseText=this.url.includes('panel-settings')?JSON.stringify({autoHideExternal:w.mockPreference}):JSON.stringify({app:'Flap Happy'});this.readyState=4;this.onreadystatechange?.();},30);}abort(){}};
  });
  await page.addScriptTag({content:readFileSync(base+'FlapHappy.js','utf8')});
  await page.evaluate(()=>document.getElementById('FlapHappyPanel')!.dispatchEvent(new Event('panelActive')));
  const hidden=async()=>page.locator('#FlapHappyPanel').evaluate(e=>getComputedStyle(e).visibility==='hidden');
  await page.waitForFunction(()=>document.querySelector<HTMLIFrameElement>('#FlapHappyFrame')?.src.includes('panel.html'));
  const src=await page.locator('#FlapHappyFrame').getAttribute('src');expect(await hidden()).toBe(false);
  await page.evaluate(()=>{(window as any).mockCamera=3;});await page.waitForFunction(()=>getComputedStyle(document.getElementById('FlapHappyPanel')!).visibility==='hidden');
  await page.evaluate(()=>{(window as any).mockFailure=true;});await page.waitForTimeout(1200);expect(await hidden()).toBe(true);
  await page.evaluate(()=>{(window as any).mockCamera=2;});await page.waitForFunction(()=>getComputedStyle(document.getElementById('FlapHappyPanel')!).visibility==='visible');expect(await page.locator('#FlapHappyFrame').getAttribute('src')).toBe(src);
  await page.evaluate(()=>{(window as any).mockCamera=8;});await page.waitForFunction(()=>getComputedStyle(document.getElementById('FlapHappyPanel')!).visibility==='hidden');
  await page.evaluate(()=>{(window as any).mockCamera=9;});await page.waitForFunction(()=>getComputedStyle(document.getElementById('FlapHappyPanel')!).visibility==='visible');
  await page.evaluate(()=>{(window as any).mockCamera=3;});await page.waitForFunction(()=>getComputedStyle(document.getElementById('FlapHappyPanel')!).visibility==='hidden');
  await page.evaluate(()=>{(window as any).mockFailure=false;(window as any).mockPreference=false;});await page.waitForFunction(()=>getComputedStyle(document.getElementById('FlapHappyPanel')!).visibility==='visible');
  await page.evaluate(()=>document.getElementById('FlapHappyPanel')!.dispatchEvent(new Event('panelInactive')));expect(await hidden()).toBe(false);await page.close();
 });
});
