import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHOT_DIR, startEnv, type Env } from './browser-env';

let env: Env;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  expect(env.errors).toEqual([]);
  await env.close();
});

describe('dev control panel drives the simulated feed', () => {
  it('IAS slider/number, flap selector, toggles and fault buttons change the display', async () => {
    const page = await env.newPage('?seed=demo', { width: 820, height: 900 });
    await page.fill('.fh-dev-iasnum', '95');
    await page.waitForTimeout(400);
    expect(await page.$eval('.fh-display .fh-readout', (e) => e.textContent)).toBe('95 kt');
    await page.selectOption('.fh-dev-flap', '5');
    await page.waitForTimeout(300);
    expect(await page.$$eval('.fh-display .fh-cell.current', (e) => e.map((x) => x.textContent))).toEqual(['5']);
    await page.click('.fh-fault[data-fault="unreadable"]');
    await page.waitForTimeout(300);
    expect(await page.$eval('.fh-display .fh-badge', (e) => e.textContent)).toBe('FLAP ?');
    await page.click('.fh-fault[data-fault="none"]');
    await page.uncheck('.fh-dev-connected');
    await page.waitForTimeout(300);
    expect(await page.$eval('.fh-display .fh-status', (e) => e.textContent)).toContain('Waiting for MSFS...');
    await page.check('.fh-dev-connected');
    await page.check('.fh-dev-ground');
    await page.waitForTimeout(300);
    expect(await page.$eval('.fh-display .fh-marker', (e) => (e as HTMLElement).style.display)).toBe('none');
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-devpanel.png` });
    await page.close();
  });

  it('scenarios run: the IAS sweep moves the marker across the whole bar, the lever sequence steps through every row', async () => {
    const page = await env.newPage('?seed=demo', { width: 820, height: 900 });
    await page.evaluate(() => { (window as any).__flapHappy.app.profile.marker_smoothing_ms = 0; });
    await page.selectOption('.fh-dev-scen', '0');
    await page.click('.fh-dev-play');
    const xs: number[] = [];
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(250);
      xs.push(await page.$eval('.fh-display .fh-readout', (e) => parseFloat(e.textContent || '0')));
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
    await page.click('.fh-dev-stop');

    await page.selectOption('.fh-dev-scen', '1');
    await page.click('.fh-dev-play');
    const seen = new Set<string>();
    for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(300);
      seen.add((await page.$$eval('.fh-display .fh-cell.current', (e) => e.map((x) => x.textContent))).join(','));
    }
    await page.click('.fh-dev-stop');
    expect(seen.size).toBeGreaterThanOrEqual(2);
    await page.close();
  });

  it('can be hidden (?dev=0) like in a release build', async () => {
    const page = await env.newPage('?seed=demo&dev=0', { width: 820, height: 600 });
    expect(await page.$$('.fh-dev')).toHaveLength(0);
    await page.close();
  });

  it('compact mode shows the display only', async () => {
    const page = await env.newPage('?seed=demo&dev=0&compact=1', { width: 700, height: 260 });
    expect(await page.$eval('.fh-root', (e) => e.classList.contains('fh-compact'))).toBe(true);
    expect(await page.isVisible('.fh-display .fh-sl')).toBe(true);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-compact.png` });
    await page.close();
  });
});

it('Demo weight slider expands to custom profile anchors and follows numeric input',async()=>{
 const page=await env.newPage('?seed=demo');try{
  await page.evaluate(()=>{const a=(window as any).__flapHappy.app,p={...a.profile,id:'custom-extreme',weight_kg:{light:250,heavy:1200}};a.setActiveProfile(p,true);});
  const slider=page.locator('.fh-dev-weight-range'),weight=page.locator('.fh-dev-weight');expect(await slider.getAttribute('min')).toBe('250');expect(await slider.getAttribute('max')).toBe('1200');
  await slider.fill('1200');expect(await weight.inputValue()).toBe('1200');await weight.fill('1300');expect(await slider.getAttribute('max')).toBe('1300');expect(await slider.inputValue()).toBe('1300');
  await weight.fill('');expect(await page.evaluate(()=> (window as any).__flapHappy.sim.controls.totalWeightKg)).toBeNull();await slider.fill('250');expect(await weight.inputValue()).toBe('250');
  await page.evaluate(()=>{const a=(window as any).__flapHappy.app,p={...a.profile,id:'regular',weight_kg:{light:400,heavy:600}};a.setActiveProfile(p,true);});expect(await slider.getAttribute('min')).toBe('280');expect(await slider.getAttribute('max')).toBe('1000');expect(await weight.inputValue()).toBe('400');
 }finally{await page.close();}
});
