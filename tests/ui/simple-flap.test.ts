import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { startEnv, SHOT_DIR, type Env } from './browser-env';
import { makeProfile, sample } from '../unit/helpers';
import { defaultSettings } from '../../core/settings';

let env: Env;
beforeAll(async () => { env = await startEnv(); });
afterAll(async () => { expect(env.errors).toEqual([]); await env.close(); });

function profile() {
  const p = makeProfile(6);
  ['L', '6', 'L–6–5', 'N', '4-3', '1'].forEach((label, i) => { p.flaps[i].label = label; });
  return p;
}

async function verify(page: Page, side: 'left' | 'right' | 'none', label = '', prefix = '') {
  const s = prefix ? prefix + ' ' : '';
  const row = page.locator(s + '.fh-simple-row');
  await row.waitFor({ state: 'visible' });
  expect(await row.locator('.fh-simple-actual').textContent()).toBe('N');
  const pills = row.locator('.fh-simple-pill:visible');
  expect(await pills.count()).toBe(side === 'none' ? 0 : 1);
  expect(await row.locator('.fh-simple-arrow.on').count()).toBe(side === 'none' ? 0 : 1);
  if (side !== 'none') {
    expect(await pills.textContent()).toBe(label);
    const arrow = row.locator('.fh-simple-arrow.on');
    expect(await arrow.getAttribute('class')).toContain(side === 'left' ? 'slower' : 'faster');
    const box = await pills.boundingBox();
    const host = await pills.locator('..').boundingBox();
    const current = await row.locator('.fh-simple-actual').boundingBox();
    const total = await row.boundingBox();
    expect(box && host && Math.abs(box.x + box.width / 2 - host.x - host.width / 2)).toBeLessThan(1.5);
    expect(current && total && Math.abs(current.x + current.width / 2 - total.x - total.width / 2)).toBeLessThan(1.5);
    const colors = await pills.evaluate(e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
    expect(colors).toEqual(['rgb(255, 218, 145)', 'rgb(27, 43, 56)']);
  }
  expect(await page.locator(s + '.fh-ias-row').isVisible()).toBe(false);
  expect(await page.locator(s + '.fh-flaps-row').isVisible()).toBe(false);
  expect(await page.locator(s + '.fh-tick-row').isVisible()).toBe(false);
}

describe('simple flap indicator', () => {
  it('settings enable/disable the transition choice without losing it; desktop shows both directions', async () => {
    const page = await env.newPage('?seed=demo', { width: 820, height: 900 });
    const p = profile();
    await page.evaluate(p => {
      const a = (window as any).__flapHappy.app;
      a.setActiveProfile(p, true);
      a.setShowTransitions(true);
      a.setBallast(0);
      const sim = (window as any).__flapHappy.sim;
      Object.assign(sim.controls, { flapCount: 6, flapIndex: 3, iasKt: 94, connected: true, onGround: false, inFlight: true });
      sim.tick(0);
    }, p);
    expect(await page.locator('.fh-display .fh-ias-row').isVisible()).toBe(true);
    await page.click('.fh-cog');await page.click('.fh-display-options summary');
    expect(await page.locator('.fh-simple-flap').isChecked()).toBe(false);
    expect(await page.locator('.fh-show-transitions').isChecked()).toBe(true);
    await page.locator('.fh-simple-flap').evaluate((el: HTMLInputElement) => el.click());
    expect(await page.locator('.fh-show-transitions').isDisabled()).toBe(true);
    expect(await page.locator('.fh-show-transitions').isChecked()).toBe(true);
    expect(await page.locator('.fh-show-ballast').isDisabled()).toBe(false);
    await page.click('.fh-back');
    await page.waitForTimeout(400);
    await verify(page, 'right', '4-3', '.fh-display');
    await page.screenshot({ path: `${SHOT_DIR}/simple-flap-desktop-right.png` });
    await page.evaluate(() => { const sim = (window as any).__flapHappy.sim; sim.controls.iasKt = 70; sim.tick(0); });
    await page.waitForTimeout(250);
    await verify(page, 'left', 'L–6–5', '.fh-display');
    await page.setViewportSize({ width: 260, height: 700 });
    await page.waitForTimeout(250);
    await verify(page, 'left', 'L–6–5', '.fh-display');
    await page.screenshot({ path: `${SHOT_DIR}/simple-flap-desktop-narrow.png` });
    await page.evaluate(() => { const sim = (window as any).__flapHappy.sim; sim.controls.iasKt = 82; sim.tick(0); });
    await page.waitForTimeout(200);
    await verify(page, 'none', '', '.fh-display');
    await page.setViewportSize({ width: 820, height: 900 });
    await page.click('.fh-cog');await page.click('.fh-display-options summary');
    await page.locator('.fh-simple-flap').evaluate((el: HTMLInputElement) => el.click());
    expect(await page.locator('.fh-show-transitions').isDisabled()).toBe(false);
    expect(await page.locator('.fh-show-transitions').isChecked()).toBe(true);
    await page.click('.fh-back');
    expect(await page.locator('.fh-display .fh-ias-row').isVisible()).toBe(true);
    expect(await page.locator('.fh-display .fh-tick-row').isVisible()).toBe(true);
    await page.close();
  });

  it('actual cockpit panel route renders the same guidance from fresh simulated state', async () => {
    const page = await env.browser.newPage({ viewport: { width: 260, height: 600 } });
    const p = profile();
    let iasKt = 94;
    let simpleFlap = true;
    let link = true;
    let failure = false;
    await page.route('**/api/state', route => route.fulfill({
      status: failure ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify({ ready: true, profile: p, sample: sample({ flapIndex: 3, flapCount: 6, iasKt, connected: link }),
        receivedAt: Date.now(), ballast: 0, units: 'kt', height: 'ft', agl: defaultSettings().agl, zoom: 1,
        simpleFlap, showBallast: false, showAgl: true, showTransitions: true, showWind: true, barShading: true }),
    }));
    await page.goto(env.url + 'panel.html');
    await page.waitForTimeout(400);
    await verify(page, 'right', '4-3');
    expect(await page.locator('.fh-agl-row').isVisible()).toBe(true);
    iasKt = 70; await page.waitForTimeout(350);
    await verify(page, 'left', 'L–6–5');
    await page.screenshot({ path: `${SHOT_DIR}/simple-flap-panel-narrow.png` });
    failure = true; await page.waitForTimeout(350);
    expect(await page.locator('.fh-simple-row').isVisible()).toBe(false);
    failure = false; await page.waitForTimeout(350);
    await verify(page, 'left', 'L–6–5');
    iasKt = 82; await page.waitForTimeout(350);
    await verify(page, 'none');
    link = false; await page.waitForTimeout(350);
    expect(await page.locator('.fh-simple-actual').textContent()).toBe('–');
    expect(await page.locator('.fh-simple-pill:visible').count()).toBe(0);
    simpleFlap = false; await page.waitForTimeout(350);
    expect(await page.locator('.fh-ias-row').isVisible()).toBe(true);
    await page.close();
  });
});
