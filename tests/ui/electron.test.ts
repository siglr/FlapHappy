import { describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {createHash} from 'node:crypto';
import { SHOT_DIR } from './browser-env';
import { makeProfile, sample } from '../unit/helpers';
import { exportProfileJson, createBlankProfile } from '../../core/profile';

const root = path.resolve(__dirname, '../..');
const electronBin = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('electron') as string;
  } catch {
    return '';
  }
})();
const canRun = !!electronBin && fs.existsSync(path.join(root, 'dist/main.js')) && (process.platform === 'win32' || !!process.env.DISPLAY);

async function launch(userData: string, extra: string[] = ['--source=simulated']): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ executablePath: electronBin, args: [root, '--no-sandbox', `--user-data=${userData}`, ...extra], cwd: root });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).__flapHappy && !!(window as any).__flapHappy.app.lastSample);
  return { app, page };
}

async function waitUntil<T>(test: () => T | Promise<T>, message = 'condition'): Promise<NonNullable<T>> {
  for (let i = 0; i < 80; i++) {
    const result = await test();
    if (result) return result as NonNullable<T>;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timed out: ' + message);
}
const panelUrl = 'http://127.0.0.1:47321';
const getFeed = async () => (await (await fetch(panelUrl + '/api/state')).json());
const settingsOnDisk = (ud: string) => JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
const panelPage = (app: ElectronApplication) => waitUntil(() => app.windows().find(w => w.url() === panelUrl + '/panel.html'), 'external panel page');
const countWindows = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const pct = (page: Page, text: string) => page.waitForFunction(t => document.querySelector('.fh-sl-pct')?.textContent === t, text);

async function openExternal(app: ElectronApplication, main: Page): Promise<Page> {
  await main.click('.fh-external-toggle');
  const panel = await panelPage(app);
  await panel.waitForSelector('.fh-sl-track');
  await main.waitForFunction(() => document.querySelector('.fh-external-toggle')?.textContent === 'Close external panel');
  return panel;
}

async function openEditor(app:ElectronApplication,main:Page):Promise<Page>{
 const created=app.waitForEvent('window');await main.click('.fh-main-profiles');const editor=await created;await editor.waitForSelector('.fh-profile-select');return editor;
}

async function closeExternal(app: ElectronApplication, main: Page): Promise<void> {
  await main.click('.fh-external-toggle');
  await waitUntil(async () => await countWindows(app) === 1, 'external closed');
  await main.waitForFunction(() => document.querySelector('.fh-external-toggle')?.textContent === 'Show external panel');
}

async function clickBallast(panel: Page, fraction: number) {
  const box = (await panel.locator('.fh-sl-track').boundingBox())!;
  await panel.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

describe.skipIf(!canRun)('visible control window and optional external panel', () => {
  it('shows desktop session status and lets keyboard tab navigation retain unsaved profile edits',async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'fh-desktop-settings-'));
    const local=makeProfile(3,{id:'local-fixture'});local.weight_kg={light:null,heavy:null};fs.mkdirSync(path.join(ud,'profiles'));fs.writeFileSync(path.join(ud,'profiles','local-fixture.json'),exportProfileJson({...local,source:'user'}));
    const {app,page}=await launch(ud);
    try{
      await page.waitForSelector('.fh-main-connection');
      expect(await page.locator('.fh-main-connection').textContent()).toBe('Demo (simulated)');
      await page.waitForFunction(()=>document.querySelector('.fh-main-aircraft')?.textContent==='Simulated glider');
      await page.selectOption('.fh-profile-mode','manual');
      await page.selectOption('.fh-profile-choice','demo-as33-18m');
      await waitUntil(async()=> (await getFeed()).profile?.id==='demo-as33-18m');
      expect(await page.locator('.fh-main-active-profile').textContent()).toBe('demo-as33-18m');
      expect(await page.locator('.fh-main-external-state').textContent()).toBe('Closed');
      const created=app.waitForEvent('window');await page.click('.fh-main-settings');const editor=await created;
      await editor.waitForSelector('.fh-settings-tab-display[aria-selected="true"]');
      const display=editor.getByRole('tab',{name:'Display'});
      await display.focus();await editor.keyboard.press('ArrowRight');
      await editor.waitForSelector('.fh-settings-tab-panel[aria-selected="true"]');
      await editor.keyboard.press('ArrowRight');await editor.waitForSelector('.fh-settings-tab-profiles[aria-selected="true"]');
      expect(await editor.locator('.fh-profile-select option[value^="demo-"]').count()).toBe(0);
      await editor.selectOption('.fh-profile-select','local-fixture');
      const field=editor.locator('[data-path="vs_min.no_ballast_kt"]');await field.waitFor();const original=await field.inputValue();
      await field.fill('33');
      await editor.getByRole('tab',{name:'Display'}).click();expect(await editor.locator('.fh-save').isVisible()).toBe(false);
      await editor.getByRole('tab',{name:'Profiles'}).click();expect(await field.inputValue()).toBe('33');expect(await editor.locator('.fh-save').isEnabled()).toBe(true);
      await editor.locator('.fh-discard-edits').click();expect(await field.inputValue()).toBe(original);
      expect(fs.readdirSync(path.join(ud,'profiles'))).toEqual(['local-fixture.json']);
      await editor.locator('.fh-back').click();
      const panel=await openExternal(app,page);expect(await panel.locator('.fh-fit').isVisible()).toBe(true);
      expect(await page.locator('.fh-main-external-state').textContent()).toBe('Open');
      await closeExternal(app,page);expect(await page.locator('.fh-main-external-state').textContent()).toBe('Closed');
    }finally{await app.close();}
  });

  it('starts visibly with no ribbon, opens/closes/reopens the common panel and keeps feeding while minimized', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-main-window-'));
    const fixture = makeProfile(2, { id: 'panel-fixture' });
    fixture.weight_kg={light:null,heavy:null};
    fs.mkdirSync(path.join(ud, 'profiles'));
    fs.writeFileSync(path.join(ud, 'profiles', fixture.id + '.json'), exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({
      schema: 'flaphappy.settings/1', last_profile_id: fixture.id,
      active_by_title: { 'Test glider': fixture.id }, ballast_by_profile: { [fixture.id]: 0.25 },
    }));
    const trace = path.join(ud, 'trace.jsonl');
    fs.writeFileSync(trace, [0, 300, 600].map(t => JSON.stringify(sample({ t, flapCount: 2 }))).join('\n'));
    const { app, page } = await launch(ud, ['--source=replay','--loop','--trace='+trace]);
    const process = app.process();
    try {
      await page.waitForSelector('.fh-main-controls');
      expect(await page.locator('.fh-fit').count()).toBe(0);
      expect(await page.isChecked('.fh-external-launch')).toBe(false);
      await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), 'main visible');
      expect(await app.evaluate(({ BrowserWindow, webContents }) => BrowserWindow.getAllWindows().map(w => ({title:w.getTitle(), visible:w.isVisible(), minimized:w.isMinimized(), webContents:webContents.getAllWebContents().length})))).toEqual([
        {title:'Flap Happy',visible:true,minimized:false,webContents:1},
      ]);
      const first = await waitUntil(async () => { const s = await getFeed(); return s.ready && s.sample?.iasKt === 70 && s.profile?.id === fixture.id ? s : null; }, 'main-owned feed');
      expect(first.ballast).toBe(0.25);
      let panel = await openExternal(app, page);
      expect(await countWindows(app)).toBe(2);
      await pct(panel, '25%');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('External panel'))!.setSize(720, 360));
      await panel.waitForTimeout(200);
      await clickBallast(panel, 0.5);
      await waitUntil(async () => (await getFeed()).ballast === 0.5, 'external ballast');
      await pct(panel, '50%');
      await closeExternal(app, page);
      const before = (await getFeed()).receivedAt;
      await waitUntil(async () => (await getFeed()).receivedAt > before + 1200, 'feed after external close');
      panel = await openExternal(app, page);
      await pct(panel, '50%');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('External panel'))!.close());
      await waitUntil(async () => await countWindows(app) === 1, 'native external close');
      await page.waitForFunction(() => document.querySelector('.fh-external-toggle')?.textContent === 'Show external panel');
      expect(await page.isChecked('.fh-external-launch')).toBe(false);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Flap Happy')!.minimize());
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
      const minAt = (await getFeed()).receivedAt;
      await waitUntil(async () => (await getFeed()).receivedAt > minAt + 1200, 'feed while main minimized');
      const { spawn } = await import('node:child_process');
      const child = spawn(electronBin, [root, '--no-sandbox','--show','--user-data='+ud], {cwd:root, stdio:'ignore', windowsHide:true});
      await new Promise<void>((resolve,reject) => { child.once('error',reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('show exit '+code))); });
      await waitUntil(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible() && !BrowserWindow.getAllWindows()[0].isMinimized()), 'main restored');
      expect(await countWindows(app)).toBe(1);
      await openExternal(app, page);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Flap Happy')!.close());
      await waitUntil(() => process.exitCode !== null, 'normal main close exits');
      expect(process.exitCode).toBe(0);
      expect(settingsOnDisk(ud).ui.external_panel_on_launch).toBe(false);
    } finally {
      if (process.exitCode === null) await app.close();
      fs.rmSync(ud, { recursive: true, force: true });
    }
  });

  it('persists the separate startup preference across actual restarts, without manual actions changing it', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-launch-option-'));
    let instance: { app: ElectronApplication; page: Page } | null = null;
    try {
      instance = await launch(ud);
      expect(await countWindows(instance.app)).toBe(1);
      expect(await instance.page.isChecked('.fh-external-launch')).toBe(false);
      await openExternal(instance.app, instance.page);
      expect(settingsOnDisk(ud).ui.external_panel_on_launch).toBe(false);
      await instance.app.close();
      instance = await launch(ud);
      expect(await countWindows(instance.app)).toBe(1);
      await instance.page.check('.fh-external-launch');
      await waitUntil(() => settingsOnDisk(ud).ui.external_panel_on_launch === true, 'startup preference saved');
      expect(await countWindows(instance.app)).toBe(1); // toggling the preference does not open it now
      await instance.app.close();
      instance = await launch(ud);
      await panelPage(instance.app);
      expect(await instance.page.isChecked('.fh-external-launch')).toBe(true);
      expect(await countWindows(instance.app)).toBe(2);
      await closeExternal(instance.app, instance.page);
      expect(settingsOnDisk(ud).ui.external_panel_on_launch).toBe(true);
      await instance.app.close();
      instance = await launch(ud);
      await panelPage(instance.app);
      expect(await countWindows(instance.app)).toBe(2);
      await instance.page.uncheck('.fh-external-launch');
      await waitUntil(() => settingsOnDisk(ud).ui.external_panel_on_launch === false, 'startup preference cleared');
      expect(await countWindows(instance.app)).toBe(2);
      await instance.app.close();
      instance = await launch(ud, ['--source=simulated','--panel-only']); // obsolete flag never hides the main window
      expect(await countWindows(instance.app)).toBe(1);
      expect(await instance.page.isChecked('.fh-external-launch')).toBe(false);
      expect(await instance.page.isVisible('.fh-main-controls')).toBe(true);
    } finally {
      if (instance) await instance.app.close().catch(() => {});
      fs.rmSync(ud, { recursive: true, force: true });
    }
  });

  it('preserves profile editing, simulator test controls, external settings and saved data on restart', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-e2e-'));
    let instance: {app: ElectronApplication; page: Page} | null = null;
    try {
      instance = await launch(ud);
      let {app,page} = instance;
      const editor=await openEditor(app,page);
      await editor.click('.fh-new');await editor.fill('.fh-new-name','new-profile');await editor.click('.fh-create');
      await editor.waitForSelector('.fh-settings .fh-addrow');
      const labels = ['5','N','4','3','2','1'];
      for (let i=0;i<6;i++) await editor.click('.fh-settings .fh-addrow');
      for (let i=0;i<6;i++) {
        await editor.fill(`.fh-settings [data-path="flaps[${i}].label"]`,labels[i]);
        await editor.fill(`.fh-settings [data-path="flaps[${i}].handle_index"]`,String(i));
      }
      await editor.fill('.fh-settings [data-path="vs_min.no_ballast_kt"]','48');
      await editor.fill('.fh-settings [data-path="vs_min.max_ballast_kt"]','56');
      const no=[62,74,86,100,118], mx=[70,83,97,113,133];
      for(let k=0;k<5;k++) {
        await editor.fill(`.fh-settings [data-path="transitions[${k}].no_ballast_kt"]`,String(no[k]));
        await editor.fill(`.fh-settings [data-path="transitions[${k}].max_ballast_kt"]`,String(mx[k]));
      }
      await editor.fill('.fh-settings [data-path="vne"]','145');
      await editor.click('.fh-settings .fh-save');
      await editor.waitForFunction(() => document.querySelector('.fh-settings .fh-savestate')?.textContent === 'Saved and applied');
      await editor.screenshot({path:`${SHOT_DIR}/flaphappy-main-settings.png`});
      await editor.click('.fh-settings .fh-back');
      let panel = await openExternal(app,page);
      await waitUntil(async()=> (await getFeed()).profile?.id==='new-profile','saved profile feed');
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('External panel'))!.setSize(720,360));
      await panel.waitForTimeout(200);
      await clickBallast(panel,0.6);
      await pct(panel,'60%');
      await waitUntil(async()=> Math.abs((await getFeed()).ballast-0.6)<1e-9,'ballast saved');
      await page.evaluate(() => { const a=(window as any).__flapHappy.app; a.setAlwaysOnTop(true); a.setOpacity(.85); const sim=(window as any).__flapHappy.sim; sim.controls.iasKt=92; sim.tick(0); });
      await waitUntil(async()=> (await getFeed()).sample?.iasKt===92,'main simulated controls reach panel');
      await waitUntil(() => app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('External panel'))!.isAlwaysOnTop()),'external topmost');
      expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Flap Happy')!.isAlwaysOnTop())).toBe(false);
      expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Flap Happy')!.getOpacity())).toBe(1);
      const saved=JSON.parse(fs.readFileSync(path.join(ud,'profiles','new-profile.json'),'utf8'));
      expect(saved.transitions).toHaveLength(5);
      await app.close();
      instance=await launch(ud);
      ({app,page}=instance);
      expect(await countWindows(app)).toBe(1);
      expect(await page.$eval('.fh-main-active-profile',e=>e.textContent)).toBe('new-profile');
      panel=await openExternal(app,page);
      await pct(panel,'60%');
      expect(await panel.$$eval('.fh-cell',els=>els.map(e=>e.textContent))).toEqual(labels);
      expect(await panel.$$eval('.fh-ticktext',els=>els.map(e=>e.textContent))).toEqual(['53','67','79','93','108','127','145']);
      expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('External panel'))!.isAlwaysOnTop())).toBe(true);
      await page.screenshot({path:`${SHOT_DIR}/flaphappy-main-restarted.png`});
    } finally {
      if(instance) await instance.app.close().catch(()=>{});
      fs.rmSync(ud,{recursive:true,force:true});
    }
  });

  it('uses upstream AGL and wind settings in the shared external and cockpit panel after main-process reconciliation',async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-agl-panel-'));
    const {app,page}=await launch(ud);let browser:import('playwright-core').Browser|undefined;
    try{
      const panel=await openExternal(app,page);
      const {chromium}=await import('playwright-core');
      const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));
      browser=await chromium.launch({executablePath,args:['--no-sandbox']});const cockpit=await browser.newPage();await cockpit.goto(panelUrl+'/panel.html');
      await page.evaluate(()=>{const a=(window as any).__flapHappy.app;const sim=(window as any).__flapHappy.sim;sim.controls.aglFt=600;sim.controls.windKt=17;sim.tick(0);a.setHeightUnit('m');a.setAglEdge('top_m',450);});
      await waitUntil(async()=>{const feed=await getFeed();return feed.height==='m'&&feed.agl.top_m===450&&feed.sample?.aglFt===600&&feed.sample?.windKt===17;},'metric AGL and wind feed');
      for(const host of [panel,cockpit]){
        await host.waitForFunction(()=>document.querySelector('.fh-aglread')?.textContent?.includes('183 m')&&document.querySelector('.fh-aglwindtext')?.textContent?.includes('17 kt'),{}, {polling:100,timeout:10000});
      }
      const editor=await openEditor(app,page);await editor.getByRole('tab',{name:'Display'}).click();await editor.locator('.fh-show-agl').locator('..').click();
      await waitUntil(async()=> (await getFeed()).showAgl===false,'AGL setting reaches session');
      for(const host of [panel,cockpit])await host.waitForFunction(()=>!document.querySelector<HTMLElement>('.fh-agl-row')?.offsetHeight,{}, {polling:100,timeout:10000});
      await editor.locator('.fh-show-agl').locator('..').click();await editor.locator('.fh-show-wind').locator('..').click();
      await waitUntil(async()=>{const f=await getFeed();return f.showAgl===true&&f.showWind===false;},'wind setting reaches session');
      for(const host of [panel,cockpit])await host.waitForFunction(()=>!!document.querySelector<HTMLElement>('.fh-agl-row')?.offsetHeight&&!document.querySelector<HTMLElement>('.fh-aglwind')?.offsetHeight,{}, {polling:100,timeout:10000});
    }finally{await browser?.close();await app.close();fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('persists Simple display settings and applies them to the actual optional external panel',async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-combined-simple-'));let instance=await launch(ud);
    try{
      let {app,page}=instance;let panel=await openExternal(app,page);let editor=await openEditor(app,page);
      await editor.getByRole('tab',{name:'Display'}).click();await editor.locator('.fh-show-transitions').locator('..').click();await editor.locator('.fh-simple-flap').locator('..').click();
      expect(await editor.locator('.fh-show-transitions').isDisabled()).toBe(true);expect(await editor.locator('.fh-show-transitions').isChecked()).toBe(true);
      await panel.waitForSelector('.fh-simple-row',{state:'visible'});expect(await panel.locator('.fh-ias-row').isVisible()).toBe(false);
      await editor.click('.fh-settings .fh-back');await app.close();instance=await launch(ud);({app,page}=instance);panel=await openExternal(app,page);await panel.waitForSelector('.fh-simple-row',{state:'visible'});
      editor=await openEditor(app,page);await editor.getByRole('tab',{name:'Display'}).click();expect(await editor.locator('.fh-show-transitions').isDisabled()).toBe(true);await editor.locator('.fh-simple-flap').locator('..').click();
      expect(await editor.locator('.fh-show-transitions').isEnabled()).toBe(true);expect(await editor.locator('.fh-show-transitions').isChecked()).toBe(true);
      await panel.waitForSelector('.fh-ias-row',{state:'visible'});
    }finally{await instance.app.close().catch(()=>{});fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('retains the cockpit-only Auto-hide setting across actual app restart and leaves the external panel visible',async()=>{
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-combined-auto-hide-'));let instance=await launch(ud);
    try{
      const read=async()=> (await (await fetch(panelUrl+'/panel-settings')).json()).autoHideExternal;
      let {app,page}=instance;let panel=await openExternal(app,page);let editor=await openEditor(app,page);
      await editor.getByRole('tab',{name:'In-sim Panel'}).click();expect(await editor.locator('.fh-auto-hide-external').isChecked()).toBe(false);
      await editor.check('.fh-auto-hide-external');await waitUntil(async()=>await read()===true,'cockpit preference');expect(await panel.locator('.fh-fit').isVisible()).toBe(true);
      await editor.click('.fh-settings .fh-back');await app.close();instance=await launch(ud);({app,page}=instance);expect(await read()).toBe(true);
      panel=await openExternal(app,page);expect(await panel.locator('.fh-fit').isVisible()).toBe(true);editor=await openEditor(app,page);await editor.getByRole('tab',{name:'In-sim Panel'}).click();expect(await editor.locator('.fh-auto-hide-external').isChecked()).toBe(true);
      await editor.uncheck('.fh-auto-hide-external');await waitUntil(async()=>await read()===false,'cockpit preference off');
    }finally{await instance.app.close().catch(()=>{});fs.rmSync(ud,{recursive:true,force:true});}
  });

  it('replay records real source samples and the cockpit panel follows changing flap positions', async () => {
    const ud=fs.mkdtempSync(path.join(os.tmpdir(),'flaphappy-e2e-'));
    fs.mkdirSync(path.join(ud,'profiles'),{recursive:true});
    fs.copyFileSync(path.join(root,'profiles/as33-18m.json'),path.join(ud,'profiles/as33-18m.json'));
    const trace=path.join(root,'tests/fixtures/sample-trace.jsonl'), rec=path.join(ud,'recorded.jsonl');
    const {app,page}=await launch(ud,['--source=replay','--trace='+trace,'--speed=2','--loop','--record='+rec]);
    try {
      const panel=await openExternal(app,page);
      await panel.waitForSelector('.fh-cell');
      const seen=new Set<string>();
      for(let i=0;i<25;i++) {
        seen.add(await panel.$$eval('.fh-cell.current',e=>e.map(x=>x.textContent).join(',')));
        await panel.waitForTimeout(200);
      }
      expect(seen.size).toBeGreaterThanOrEqual(3);
      expect(await page.$eval('.fh-main-connection',e=>e.textContent)).not.toContain('DEMO');
      expect(await panel.$eval('.fh-readout',e=>e.textContent)).toMatch(/kt$/);
      await panel.screenshot({path:`${SHOT_DIR}/flaphappy-external-replay.png`});
    } finally {
      await app.close();
      expect(fs.readFileSync(rec,'utf8').trim().split('\n').length).toBeGreaterThan(10);
      fs.rmSync(ud,{recursive:true,force:true});
    }
  });
});

// The real profile editor, main session and cockpit feed must agree after deletion.
it.skipIf(!canRun)('deletes only a saved local profile after named confirmation and clears panel assignments',async()=>{
 const ud=fs.mkdtempSync(path.join(os.tmpdir(),'fh-delete-profile-')),id='demo-user-copy',other='other-local';
 fs.mkdirSync(path.join(ud,'profiles'));for(const name of [id,other])fs.writeFileSync(path.join(ud,'profiles',name+'.json'),exportProfileJson({...makeProfile(3,{id:name}),source:'user'}));
 fs.writeFileSync(path.join(ud,'settings.json'),JSON.stringify({schema:'flaphappy.settings/1',last_profile_id:id,profile_selection:{mode:'manual',manualId:id,fallbackId:id},active_by_title:{aircraft:id,other:other}}));
 const {app,page}=await launch(ud);try{
   await waitUntil(async()=> (await getFeed()).profile?.id===id);
   const editor=await openEditor(app,page);expect(await editor.locator('.fh-profile-select option[value="demo-js3"]').count()).toBe(0);expect(await editor.locator('.fh-profile-select option[value="'+id+'"]').count()).toBe(1);
   editor.once('dialog',async d=>{expect(d.message()).toContain('demo-user-copy');await d.dismiss();});await editor.click('.fh-delete-profile');expect(fs.existsSync(path.join(ud,'profiles',id+'.json'))).toBe(true);
   editor.once('dialog',d=>d.accept());await editor.click('.fh-delete-profile');await waitUntil(()=>!fs.existsSync(path.join(ud,'profiles',id+'.json')));
   await waitUntil(async()=> (await getFeed()).profile===null);expect(fs.existsSync(path.join(ud,'profiles',id+'.json.deleted.bak'))).toBe(true);expect(fs.existsSync(path.join(ud,'profiles',other+'.json'))).toBe(true);
   const saved=settingsOnDisk(ud);expect(saved.profile_selection.manualId).toBeNull();expect(saved.profile_selection.fallbackId).toBeNull();expect(saved.active_by_title).toEqual({other:other});
 }finally{await app.close();}
});

it.skipIf(!canRun)('Demo profile selection aligns routed flap count and weight, while an explicit mismatch persists in both display modes',async()=>{
 const ud=fs.mkdtempSync(path.join(os.tmpdir(),'fh-demo-count-')),cache=path.join(ud,'wsg-public-cache');fs.mkdirSync(cache);
 const write=(url:string,raw:unknown)=>fs.writeFileSync(path.join(cache,createHash('sha256').update(url).digest('hex')+'.json'),JSON.stringify(raw));
 const profiles=['A-DEMO','B-DEMO'].map((key,j)=>{const count=j?3:8;const bands=Array.from({length:count},(_,i)=>({label:String(count-i),handleIndex:count-i-1,lightStartKt:i?45+i*5:0,heavyStartKt:i?50+i*5:0,excludeFromDisplay:false}));return {schema:'wsg.flaphappy.profile/1',variantKey:key,lightWeightKg:400,heavyWeightKg:600,handleCount:count,bands};});
 write('https://wesimglide.org/api/flap-happy/catalog-v2.json',{schema:'wsg.flaphappy.catalog/2',revision:1,profiles});
 for(const p of profiles)write('https://wesimglide.org/api/GetGliderReference.php?type='+p.variantKey,{ok:true,schemaVersion:1,status:'matched',glider:{gliderKey:p.variantKey,displayName:p.variantKey,hasFlaps:true,flapCount:p.handleCount,flapLabels:Object.fromEntries(p.bands.map(b=>[String(b.handleIndex+1),b.label])),vneTasKph:280}});
 const env={...process.env,NODE_USE_ENV_PROXY:'1',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'localhost,127.0.0.1'};
 const app=await electron.launch({executablePath:electronBin,args:[root,'--no-sandbox','--user-data='+ud,'--source=simulated'],cwd:root,env});
 try{const main=await app.firstWindow();await main.waitForSelector('.fh-main-controls');await main.locator('.fh-profile-mode').selectOption('manual');await main.waitForFunction(()=>document.querySelector('option[value="WSG:A-DEMO"]'));
  const select=async(key:string,count:number)=>{await main.locator('.fh-profile-choice').selectOption('WSG:'+key);await waitUntil(async()=>{const s=await getFeed();return s.profile?.wsg?.variantKey===key&&s.sample?.flapCount===count&&s.sample?.totalWeightKg===400;});await main.waitForFunction(n=>document.querySelector<HTMLInputElement>('.fh-dev-count')?.value===String(n),count);};
  await select('A-DEMO',8);
  const weight=main.locator('.fh-dev-weight'),slider=main.locator('.fh-dev-weight-range');expect(await slider.getAttribute('min')).toBe('280');expect(await slider.getAttribute('max')).toBe('1000');expect(await weight.inputValue()).toBe('400');
  await slider.fill('1000');await waitUntil(async()=>(await getFeed()).sample?.totalWeightKg===1000);expect(await weight.inputValue()).toBe('1000');await weight.fill('280');await waitUntil(async()=>(await getFeed()).sample?.totalWeightKg===280);expect(await slider.inputValue()).toBe('280');
  await weight.fill('');await waitUntil(async()=>(await getFeed()).sample?.totalWeightKg===null);await slider.fill('400');await waitUntil(async()=>(await getFeed()).sample?.totalWeightKg===400);expect(await weight.inputValue()).toBe('400');
  await main.locator('.fh-dev-flap').selectOption('7');await waitUntil(async()=>(await getFeed()).sample?.flapIndex===7);
  await main.click('.fh-external-toggle');const panel=await panelPage(app);await panel.waitForFunction(()=>document.querySelectorAll('.fh-cell').length===8);expect(await panel.locator('.fh-profile-alert').isVisible()).toBe(false);
  await select('B-DEMO',3);await waitUntil(async()=>(await getFeed()).sample?.flapIndex===2);expect(await main.locator('.fh-dev-flap').inputValue()).toBe('2');await panel.waitForFunction(()=>document.querySelectorAll('.fh-cell').length===3);
  await main.fill('.fh-dev-count','2');await panel.waitForFunction(()=>document.querySelector('.fh-profile-alert')?.textContent?.includes('expected 3, received 2'));await main.waitForTimeout(500);expect((await getFeed()).sample.flapCount).toBe(2);expect(await panel.locator('.fh-cell.recommended').count()).toBe(0);
  await main.evaluate(()=> (window as any).__flapHappy.app.setSimpleFlap(true));await panel.waitForFunction(()=>document.querySelector('.fh-profile-alert')?.textContent?.includes('expected 3, received 2'));expect(await panel.locator('.fh-profile-alert').isVisible()).toBe(true);
  await main.locator('.fh-dev-reset-count').click();await waitUntil(async()=>(await getFeed()).sample?.flapCount===3);await panel.waitForFunction(()=>!document.querySelector('.fh-profile-alert')?.getClientRects().length);
  await select('A-DEMO',8);
  const editor=await openEditor(app,main);await editor.waitForFunction(()=>document.querySelector('option[value=":wsg:A-DEMO"]')!==null);await editor.selectOption('.fh-profile-select',':wsg:A-DEMO');
  for(const zoom of [1,1.5]){await app.evaluate(({BrowserWindow},z)=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Settings'))!.webContents.setZoomFactor(z),zoom);await editor.waitForTimeout(150);const measured=await editor.locator('[aria-label="Transition 0 visibility"]').evaluate(el=>{const sel=el as HTMLSelectElement,style=getComputedStyle(sel),ctx=document.createElement('canvas').getContext('2d')!;ctx.font=style.font;return {available:sel.clientWidth,needed:ctx.measureText(sel.selectedOptions[0].textContent??'').width+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+24};});expect(measured.available).toBeGreaterThanOrEqual(measured.needed);}
  await editor.locator('.fh-back').click();
 }finally{await app.close();}
});
