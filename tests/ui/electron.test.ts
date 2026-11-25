import { describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SHOT_DIR } from './browser-env';
import { createBlankProfile, exportProfileJson } from '../../core/profile';
import { makeProfile } from '../unit/helpers';

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

describe.skipIf(!canRun)('Electron shell (simulated source): window, files, restart', () => {
  it('opens the window, builds a profile in the editor, saves real files, and restores everything after a restart', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-e2e-'));
    let { app, page } = await launch(ud);

    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('Flap Happy');
    expect(await page.title()).toBe('Flap Happy');

    // First launch installs the three built-in profiles and opens AS33-18m.
    await page.waitForSelector('.fh-display .fh-cell');
    expect(await page.$$eval('.fh-display .fh-cell', (e) => e.length)).toBe(6);
    await page.click('.fh-cog');
    await page.click('.fh-new');
    await page.fill('.fh-new-name', 'new-profile');
    await page.click('.fh-create');
    expect(fs.existsSync(path.join(ud,'profiles','new-profile.json'))).toBe(false);
    await page.waitForSelector('.fh-settings .fh-addrow');
    const labels = ['5', 'N', '4', '3', '2', '1'];
    for (let i = 0; i < 6; i++) await page.click('.fh-settings .fh-addrow');
    for (let i = 0; i < 6; i++) await page.fill(`.fh-settings [data-path="flaps[${i}].label"]`, labels[i]);
    for (let i = 0; i < 6; i++) await page.fill(`.fh-settings [data-path="flaps[${i}].handle_index"]`, String(i));
    expect(await page.locator('.fh-weight-mode').inputValue()).toBe('manual');
    expect(await page.locator('.fh-settings [data-path="weight_kg.light"]').count()).toBe(0);
    await page.fill('.fh-settings [data-path="vs_min.no_ballast_kt"]', '48');
    await page.fill('.fh-settings [data-path="vs_min.max_ballast_kt"]', '56');
    const no = [62, 74, 86, 100, 118];
    const mx = [70, 83, 97, 113, 133];
    for (let k = 0; k < 5; k++) {
      await page.fill(`.fh-settings [data-path="transitions[${k}].no_ballast_kt"]`, String(no[k]));
      await page.fill(`.fh-settings [data-path="transitions[${k}].max_ballast_kt"]`, String(mx[k]));
    }
    await page.fill('.fh-settings [data-path="vne"]', '145');
    await page.click('.fh-settings .fh-save');
    await page.waitForFunction(() => document.querySelector('.fh-settings .fh-savestate')!.textContent === 'Saved and applied');
    const manualPath = path.join(ud, 'profiles', 'new-profile.json');
    expect(JSON.parse(fs.readFileSync(manualPath, 'utf8')).weight_kg).toEqual({light: null, heavy: null});
    await page.click('.fh-settings .fh-back');
    await page.waitForSelector('.fh-ballast-row');
    await page.waitForTimeout(650);
    await app.close();
    ({ app, page } = await launch(ud));
    await page.waitForFunction(() => (window as any).__flapHappy.profileId() === 'new-profile');
    await page.waitForSelector('.fh-ballast-row');
    await page.click('.fh-cog');
    await page.waitForSelector('.fh-weight-mode');
    expect(await page.locator('.fh-weight-mode').inputValue()).toBe('manual');
    await page.selectOption('.fh-weight-mode', 'live');
    expect(await page.locator('.fh-settings .fh-save').isDisabled()).toBe(true);
    expect(await page.locator('.fh-settings .fh-saveas').isDisabled()).toBe(true);
    await page.fill('.fh-settings [data-path="weight_kg.light"]', '400');
    expect(await page.locator('.fh-settings .fh-save').isDisabled()).toBe(true);
    await page.click('.fh-settings .fh-back');
    expect(await page.locator('.fh-display .fh-save').isDisabled()).toBe(true);
    expect(JSON.parse(fs.readFileSync(manualPath, 'utf8')).weight_kg).toEqual({light: null, heavy: null});
    await page.click('.fh-cog');
    await page.waitForSelector('.fh-weight-mode');
    expect(await page.locator('.fh-weight-mode').inputValue()).toBe('live');
    expect(await page.locator('.fh-settings [data-path="weight_kg.light"]').inputValue()).toBe('400');
    await page.fill('.fh-settings [data-path="weight_kg.heavy"]', '399');
    expect(await page.locator('.fh-settings .fh-save').isDisabled()).toBe(true);
    await page.fill('.fh-settings [data-path="weight_kg.heavy"]', '600');
    expect(await page.locator('.fh-settings .fh-save').isEnabled()).toBe(true);
    await page.selectOption('.fh-weight-mode', 'manual');
    expect(await page.locator('.fh-settings [data-path="weight_kg.light"]').count()).toBe(0);
    await page.selectOption('.fh-weight-mode', 'live');
    expect(await page.locator('.fh-settings [data-path="weight_kg.light"]').inputValue()).toBe('400');
    expect(await page.locator('.fh-settings [data-path="weight_kg.heavy"]').inputValue()).toBe('600');
    await page.click('.fh-settings .fh-save');
    await page.waitForFunction(() => document.querySelector('.fh-settings .fh-savestate')!.textContent === 'Saved and applied');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 900));
    for (const zoom of [1,1.25,1.5,2]) {
      await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom);
      await page.waitForTimeout(100);
      const fit = await page.evaluate(() => document.querySelector('.fh-sethead .fh-save')!.getBoundingClientRect().right <= window.innerWidth && Array.from(document.querySelectorAll('.fh-transition-row')).every(row => {
        const input = row.querySelectorAll('input'); const a = input[0].getBoundingClientRect(), b = input[1].getBoundingClientRect();
        return a.right <= b.left && b.right <= window.innerWidth;
      }));
      expect(fit).toBe(true);
      const png = await app.evaluate(async ({ BrowserWindow }) => Array.from((await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG()));
      fs.writeFileSync(`${SHOT_DIR}/flaphappy-editor-zoom-${Math.round(zoom*100)}.png`, Buffer.from(png));
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-electron-editor.png` });
    await page.click('.fh-settings .fh-back');

    // Synthetic telemetry is not a saved pilot preference.
    await page.evaluate(() => { const sim = (window as any).__flapHappy.sim; sim.controls.totalWeightKg = 520; sim.tick(0); });
    expect(await page.$eval('.fh-display .fh-sl-pct', (e) => e.textContent)).toBe('520 kg');
    await page.click('.fh-display .fh-pin');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(true);
    await page.waitForTimeout(900);

    const file = path.join(ud, 'profiles', 'new-profile.json');
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.display_name).toBeUndefined();
    expect(onDisk.transitions).toHaveLength(5);
    expect(onDisk.weight_kg).toEqual({ light: 400, heavy: 600 });
    expect(fs.existsSync(path.join(ud, 'settings.json'))).toBe(true);
    await app.close();

    // Restart with the same user data folder.
    ({ app, page } = await launch(ud));
    await page.waitForSelector('.fh-display .fh-cell');
    expect(await page.$eval('.fh-display .fh-title', (e) => e.textContent)).toBe('new-profile');
    expect(await page.$$eval('.fh-display .fh-cell', (e) => e.map((x) => x.textContent))).toEqual(labels);
    expect(await page.$eval('.fh-display .fh-sl-pct', (e) => e.textContent)).toBe('-- kg');
    await page.evaluate(() => { const sim = (window as any).__flapHappy.sim; sim.controls.totalWeightKg = 520; sim.tick(0); });
    expect(await page.$$eval('.fh-display .fh-ticktext', (e) => e.map((x) => x.textContent))).toEqual(['53', '67', '79', '93', '108', '127', '145']);
    expect(await page.$eval('.fh-display .fh-sl-pct', (e) => e.textContent)).toBe('520 kg');
    expect(await page.$('.fh-display .fh-sl-flag')).toBeNull();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-electron-restarted.png` });
    await page.click('.fh-cog');
    await page.waitForSelector('.fh-weight-mode');
    expect(await page.locator('.fh-weight-mode').inputValue()).toBe('live');
    await page.selectOption('.fh-weight-mode', 'manual');
    await page.click('.fh-settings .fh-save');
    await page.waitForFunction(() => document.querySelector('.fh-settings .fh-savestate')!.textContent === 'Saved and applied');
    const manual = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(manual.weight_kg).toEqual({light: null, heavy: null});
    expect(manual.transitions).toEqual(onDisk.transitions);
    await page.click('.fh-settings .fh-back');
    await page.waitForSelector('.fh-ballast-row');
    await app.close();
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('desktop and served cockpit panel use the same live weight and neither offers a ballast control', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-live-weight-'));
    const fixture = makeProfile(2, { id: 'weight-fixture' });
    fs.mkdirSync(path.join(ud, 'profiles'));
    fs.writeFileSync(path.join(ud, 'profiles', fixture.id + '.json'), exportProfileJson(fixture));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ schema: 'flaphappy.settings/1', last_profile_id: fixture.id, active_by_title: { 'Simulated glider': fixture.id }, ui: { show_transitions: true } }));
    const { app, page } = await launch(ud);
    await page.waitForFunction(() => (window as any).__flapHappy.profileId() === 'weight-fixture');
    let browser: import('playwright-core').Browser | undefined;
    try {
      const { chromium } = await import('playwright-core');
      const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
      browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
      const panel = await browser.newPage();
      const panelUrl = 'http://127.0.0.1:47321';
      await panel.goto(panelUrl + '/panel.html');
      const simulated = (patch: Record<string, unknown>) => page.evaluate(value => {
        const sim = (window as any).__flapHappy.sim;
        Object.assign(sim.controls, value);
        sim.tick(0);
      }, patch);
      const verify = async (kg: number | null, ticks: string[]) => {
        await simulated({ totalWeightKg: kg });
        const expected = kg === null ? '-- kg' : kg + ' kg';
        for (const view of [page, panel]) {
          await view.waitForFunction(text => document.querySelector('.fh-sl-pct')?.textContent === text, expected);
          const visibleTicks = await view.$$eval('.fh-ticktext', els => els.filter(x => getComputedStyle(x).display !== 'none').map(x => x.textContent));
          expect(visibleTicks).toEqual(ticks);
          expect(await view.locator('.fh-weight-row input, .fh-weight-row button, .fh-ballast-row').count()).toBe(0);
        }
      };
      await simulated({ aglFt: 650, windKt: 13 });
      for (const view of [page, panel]) {
        await view.waitForFunction(() => document.querySelector('.fh-aglread')?.textContent === '650 ft' && document.querySelector('.fh-aglwindtext')?.textContent === '13 kt');
      }
      await verify(300, ['40','52','82']);
      await verify(500, ['45','59','82']);
      await verify(800, ['50','66','82']);
      expect((await fetch(panelUrl + '/api/ballast', { method: 'POST', body: '{"f":0}' })).status).toBe(405);
      await verify(null, []);
      await verify(500, ['45','59','82']);
      // A lost or invalid panel response cannot retain the last flying weight.
      await panel.route('**/api/state', route => route.fulfill({ status: 200, body: 'not JSON' }));
      await panel.waitForFunction(() => document.querySelector<HTMLElement>('.fh-fit')?.style.display === 'none');
      await panel.unroute('**/api/state');
      await panel.waitForFunction(() => document.querySelector('.fh-sl-pct')?.textContent === '500 kg');
      await simulated({ fault: 'stale' });
      for (const view of [page, panel]) {
        await view.waitForFunction(() => document.querySelector('.fh-sl-pct')?.textContent === '-- kg');
        expect(await view.locator('.fh-ticktext:visible').count()).toBe(0);
        expect(await view.locator('.fh-aglread').textContent()).toBe('--- ft');
        expect(await view.locator('.fh-aglwindtext').textContent()).toBe('--- kt');
      }
    } finally {
      await browser?.close();
      await app.close();
      fs.rmSync(ud, { recursive: true, force: true });
    }
  });

  it('restores the original manual slider for legacy profiles in both windows and persists the selected fraction', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-legacy-weight-'));
    const legacy = makeProfile(2, { id: 'legacy-fixture' });
    legacy.weight_kg = { light: null, heavy: null };
    legacy.ballast.default_fraction = 0.25;
    legacy.ballast.max_ballast_litres = 200;
    fs.mkdirSync(path.join(ud, 'profiles'));
    const file = JSON.parse(exportProfileJson(legacy));
    delete file.weight_kg;
    fs.writeFileSync(path.join(ud, 'profiles', legacy.id + '.json'), JSON.stringify(file));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ schema: 'flaphappy.settings/1', last_profile_id: legacy.id, active_by_title: { 'Simulated glider': legacy.id }, ui: { show_transitions: true } }));
    let { app, page } = await launch(ud);
    let browser: import('playwright-core').Browser | undefined;
    try {
      const { chromium } = await import('playwright-core');
      const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
      browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
      const panel = await browser.newPage();
      const panelUrl = 'http://127.0.0.1:47321';
      await panel.goto(panelUrl + '/panel.html');
      const read = async (view: Page, pct: string, ticks: string[]) => {
        await view.waitForFunction(({ text, expected }) => document.querySelector('.fh-ballast-row .fh-sl-pct')?.textContent === text &&
          Array.from(document.querySelectorAll('.fh-ticktext')).filter(x => getComputedStyle(x).display !== 'none').map(x => x.textContent).join(',') === expected.join(','), { text: pct, expected: ticks }, { timeout: 5000 });
        expect(await view.locator('.fh-weight-row').count()).toBe(0);
        expect(await view.$$eval('.fh-ticktext:visible', els => els.map(x => x.textContent))).toEqual(ticks);
      };
      for (const view of [page, panel]) {
        await read(view, '25% 50 L', ['43', '56', '82']);
        await view.waitForFunction(() => document.querySelector('.fh-aglread')?.textContent === '600 ft' && document.querySelector('.fh-aglwindtext')?.textContent === '12 kt');
      }
      const click = async (view: Page, f: number) => {
        const track = view.locator('.fh-ballast-row .fh-sl-track');
        const r = (await track.boundingBox())!;
        await view.bringToFront();
        await view.mouse.click(r.x + r.width * f, r.y + r.height / 2);
      };
      await click(panel, 0.75);
      for (const view of [page, panel]) await read(view, '75% 150 L', ['48', '63', '82']);
      // A two-flap strip with transitions and AGL can exceed the compact window height.
      // Resize the actual Electron window, just as a pilot can, before clicking.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 320));
      await page.waitForFunction(() => window.innerHeight >= 300);
      await click(page, 0.5);
      for (const view of [page, panel]) await read(view, '50% 100 L', ['45', '59', '82']);
      expect((await fetch(panelUrl + '/api/ballast', { method: 'POST', body: JSON.stringify({ profileId: 'wrong-profile', f: 0 }) })).status).toBe(409);
      await page.evaluate(() => { const sim = (window as any).__flapHappy.sim; sim.controls.totalWeightKg = 800; sim.tick(0); });
      for (const view of [page, panel]) await read(view, '50% 100 L', ['45', '59', '82']);
      await page.waitForTimeout(650);
      expect(JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).ballast_by_profile[legacy.id]).toBe(0.5);
      await browser.close(); browser = undefined;
      await app.close();
      ({ app, page } = await launch(ud));
      await read(page, '50% 100 L', ['45', '59', '82']);
      await page.evaluate((p) => { const a = (window as any).__flapHappy.app; a.setActiveProfile(p, true); }, makeProfile(2, { id: legacy.id }));
      await page.waitForSelector('.fh-weight-row');
      expect(await page.locator('.fh-ballast-row').count()).toBe(0);
      await page.evaluate((p) => { const a = (window as any).__flapHappy.app; a.setActiveProfile(p, true); }, legacy);
      await read(page, '50% 100 L', ['45', '59', '82']);
    } finally {
      await browser?.close();
      await app.close();
      fs.rmSync(ud, { recursive: true, force: true });
    }
  });

  it('starts in compact mode with no MINI/FULL button and keeps the display', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-e2e-'));
    const { app, page } = await launch(ud);
    await page.waitForFunction(() => document.querySelector('.fh-root.fh-compact') !== null);
    expect(await page.$('.fh-compact-btn')).toBeNull();
    expect(await page.$$eval('.fh-display .fh-cell', (e) => e.length)).toBe(6);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-electron-compact.png` });
    await app.close();
    fs.rmSync(ud, { recursive: true, force: true });
  });

  it('replay source: samples travel main process -> IPC bridge -> UI, and --record writes a trace', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-e2e-'));
    fs.mkdirSync(path.join(ud, 'profiles'), { recursive: true });
    fs.copyFileSync(path.join(root, 'profiles/as33-18m.json'), path.join(ud, 'profiles/as33-18m.json'));
    const trace = path.join(root, 'tests/fixtures/sample-trace.jsonl');
    const rec = path.join(ud, 'recorded.jsonl');
    const { app, page } = await launch(ud, ['--source=replay', `--trace=${trace}`, '--speed=2', '--loop', `--record=${rec}`]);
    await page.waitForSelector('.fh-display .fh-cell');
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const cur = await page.$$eval('.fh-display .fh-cell.current', (e) => e.map((x) => x.textContent).join(','));
      seen.add(cur);
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(await page.$eval('.fh-display .fh-status', (e) => e.textContent)).not.toContain('DEMO');
    expect(await page.$eval('.fh-display .fh-readout', (e) => e.textContent)).toMatch(/kt$/);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-electron-replay.png` });
    await app.close();
    expect(fs.readFileSync(rec, 'utf8').trim().split('\n').length).toBeGreaterThan(10);
    fs.rmSync(ud, { recursive: true, force: true });
  });
});
