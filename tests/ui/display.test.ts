import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { SHOT_DIR, startEnv, type Env } from './browser-env';
import { makeProfile } from '../unit/helpers';
import type { Profile } from '../../core/types';

let env: Env;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  expect(env.errors).toEqual([]);
  await env.close();
});

const settle = (page: Page, ms = 350) => page.waitForTimeout(ms);

async function load(page: Page, p: Profile) {
  await page.evaluate((prof) => {
    const w = window as any;
    w.__flapHappy.app.setShowTransitions(true);
    w.__flapHappy.app.setActiveProfile(prof, true);
    w.__flapHappy.sim.controls.flapCount = prof.flaps.length;
    w.__flapHappy.sim.controls.totalWeightKg = prof.weight_kg.light;
    w.__flapHappy.sim.tick(0);
  }, p as any);
  await settle(page);
}

const sim = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((c) => {
    const w = window as any;
    Object.assign(w.__flapHappy.sim.controls, c);
    w.__flapHappy.sim.tick(0);
  }, patch);

async function clickBallast(page: Page, frac: number) {
  await sim(page, { totalWeightKg: 400 + frac * 200 });
}

const geometry = (page: Page) =>
  page.evaluate(() => {
    const rect = (el: Element) => el.getBoundingClientRect();
    const ticks = Array.from(document.querySelectorAll('.fh-display .fh-tick')).map((t) => rect(t).left + rect(t).width / 2);
    const wraps = Array.from(document.querySelectorAll('.fh-display .fh-cellwrap')).map((c) => ({ l: rect(c).left, r: rect(c).right }));
    const labels = Array.from(document.querySelectorAll('.fh-display .fh-ticktext')).map((t) => rect(t).left + rect(t).width / 2);
    const marker = document.querySelector('.fh-display .fh-marker') as HTMLElement;
    const track = document.querySelector('.fh-display .fh-track') as HTMLElement;
    return {
      ticks,
      wraps,
      labels,
      markerX: marker && marker.style.display !== 'none' ? rect(marker).left + rect(marker).width / 2 : null,
      trackL: rect(track).left,
      trackR: rect(track).right,
      current: document.querySelectorAll('.fh-display .fh-cell.current').length,
      cells: document.querySelectorAll('.fh-display .fh-cell').length,
    };
  });

describe('display layout: bar, ticks and flap cells share N columns', () => {
  for (const n of [1, 2, 6, 10]) {
    it(`N = ${n}: ticks and tick labels line up with the cell edges, one highlighted cell`, async () => {
      const page = await env.newPage('?seed=demo');
      const p = makeProfile(n);
      await load(page, p);
      await sim(page, { flapIndex: Math.min(1, n - 1), iasKt: 60, totalWeightKg: 600 });
      await settle(page);
      const g = await geometry(page);
      expect(g.cells).toBe(n);
      expect(g.ticks).toHaveLength(n + 1);
      expect(g.current).toBe(1);
      for (let i = 0; i < n; i++) {
        expect(Math.abs(g.ticks[i] - (g.wraps[i].l)), `tick ${i}`).toBeLessThan(1.5);
        expect(Math.abs(g.labels[i] - g.ticks[i])).toBeLessThan(1.5);
      }
      expect(Math.abs(g.ticks[n] - g.wraps[n - 1].r)).toBeLessThan(1.5);
      // Equal widths.
      const widths = g.wraps.map((w) => w.r - w.l);
      widths.forEach((w) => expect(Math.abs(w - widths[0])).toBeLessThan(1.5));
      // Cells are at least 56 px wide at native size: width / scale.
      await page.screenshot({ path: `${SHOT_DIR}/flaphappy-display-n${n}.png` });
      await page.close();
    });
  }

  it('weight re-aligns the ticks (labels follow actual weight) and they stay aligned with the cells', async () => {
    const page = await env.newPage('?seed=demo');
    await load(page, makeProfile(6));
    await clickBallast(page, 0);
    await settle(page);
    const labels = () => page.$$eval('.fh-display .fh-ticktext', (els) => els.map((e) => e.textContent));
    expect(await labels()).toEqual(['40', '52', '64', '76', '88', '100', '146']);
    await clickBallast(page, 1);
    await settle(page);
    expect(await labels()).toEqual(['50', '66', '82', '98', '114', '130', '146']);
    const g = await geometry(page);
    for (let i = 0; i < 6; i++) expect(Math.abs(g.ticks[i] - g.wraps[i].l)).toBeLessThan(1.5);
    await page.close();
  });

  it('linear scale: cell widths follow the speed ranges and ticks still meet cell edges', async () => {
    const page = await env.newPage('?seed=demo');
    const p = makeProfile(4);
    p.transitions[0].no_ballast_kt = 44;
    p.transitions[0].max_ballast_kt = 56;
    await load(page, p);
    await clickBallast(page, 0);
    await settle(page);
    const g = await geometry(page);
    for (let i = 0; i < 4; i++) expect(Math.abs(g.ticks[i] - g.wraps[i].l)).toBeLessThan(1.5);
    // Buckets 40-44-64-76-114 kt: widths are 4/74, 20/74, 12/74, 38/74 of the bar.
    const widths = g.wraps.map((w) => w.r - w.l);
    const bar = g.trackR - g.trackL;
    [4, 20, 12, 38].forEach((kt, i) => expect(Math.abs(widths[i] - (bar * kt) / 74)).toBeLessThan(2));
    await page.close();
  });
});

describe('current-flap highlight and IAS marker', () => {
  it('only the current flap is highlighted, following the lever for every row', async () => {
    const page = await env.newPage('?seed=demo');
    const p = makeProfile(6);
    await load(page, p);
    for (let i = 0; i < 6; i++) {
      await sim(page, { flapIndex: i, iasKt: 70 });
      await settle(page, 120);
      const cur = await page.$$eval('.fh-display .fh-cell', (els) => els.map((e) => e.classList.contains('current')));
      expect(cur.filter(Boolean)).toHaveLength(1);
      expect(cur.indexOf(true)).toBe(i);
    }
    await page.close();
  });

  it('the marker crosses a tick exactly when IAS crosses the transition (any N)', async () => {
    for (const n of [2, 6]) {
      const page = await env.newPage('?seed=demo');
      await load(page, makeProfile(n));
      await clickBallast(page, 0);
      await settle(page);
      await page.evaluate(() => { (window as any).__flapHappy.app.profile.marker_smoothing_ms = 0; });
      for (let k = 1; k < n; k++) {
        await sim(page, { iasKt: 40 + 12 * k });
        await settle(page, 120);
        const g = await geometry(page);
        expect(Math.abs((g.markerX as number) - g.ticks[k]), `N=${n} tick ${k}`).toBeLessThan(2.5);
      }
      await page.close();
    }
  });

  it('marker is not tied to the highlight: lever on flap 2 while IAS sits in column 5', async () => {
    const page = await env.newPage('?seed=demo');
    await load(page, makeProfile(6));
    await clickBallast(page, 0);
    await settle(page);
    await page.evaluate(() => { (window as any).__flapHappy.app.profile.marker_smoothing_ms = 0; });
    await sim(page, { flapIndex: 1, iasKt: 94 });
    await settle(page);
    const g = await geometry(page);
    expect(g.current).toBe(1);
    expect(g.markerX as number).toBeGreaterThan(g.ticks[4]);
    expect(g.markerX as number).toBeLessThan(g.ticks[5]);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-display-marker-vs-flap.png` });
    await page.close();
  });
});

describe('states and the current-flap fallback chain (simulated feed)', () => {
  const text = (page: Page, sel: string) => page.$eval(sel, (e) => e.textContent);

  it('exercises every fallback state', async () => {
    const page = await env.newPage('?seed=demo');
    const p = makeProfile(6); // indices 0..5, 8 lever positions
    await load(page, p);
    await sim(page, { flapCount: 8, flapIndex: 3, iasKt: 90, fault: 'none' });
    await settle(page, 200);
    const cur = () => page.$$eval('.fh-display .fh-cell', (els) => els.map((e, i) => (e.classList.contains('current') ? i : -1)).filter((i) => i >= 0));
    expect(await cur()).toEqual([3]);
    expect(await text(page, '.fh-display .fh-badge')).toBe('');

    // index missing -> percent
    await sim(page, { fault: 'index-missing' });
    await page.waitForTimeout(500);
    expect(await cur()).toEqual([3]);
    // out of range -> percent
    await sim(page, { fault: 'index-out-of-range' });
    await page.waitForTimeout(300);
    expect(await cur()).toEqual([3]);
    // percent only (8 positions: 3/7)
    await sim(page, { fault: 'percent-only' });
    await page.waitForTimeout(300);
    expect(await cur()).toEqual([3]);
    // nothing readable -> FLAP ? and the marker still works
    await sim(page, { fault: 'unreadable' });
    await page.waitForTimeout(300);
    expect(await cur()).toEqual([]);
    expect(await text(page, '.fh-display .fh-badge')).toBe('FLAP ?');
    expect(await page.$eval('.fh-display .fh-marker', (e) => (e as HTMLElement).style.display)).toBe('block');
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-state-flap-unknown.png` });

    // other position (index 6 is not a row)
    await sim(page, { fault: 'none', flapIndex: 6 });
    await page.waitForTimeout(300);
    expect(await cur()).toEqual([]);
    expect(await text(page, '.fh-display .fh-badge')).toBe('#6');
    await page.close();
  });

  it('shows Waiting, No data, Paused, LOW and FAST states', async () => {
    const page = await env.newPage('?seed=demo');
    await load(page, makeProfile(6));
    const status = () => text(page, '.fh-display .fh-status');
    await sim(page, { connected: false });
    await settle(page, 200);
    expect(await status()).toContain('Waiting for MSFS...');
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-state-waiting.png` });
    await sim(page, { connected: true, inFlight: false });
    await settle(page, 200);
    expect(await status()).toContain('Paused');
    await sim(page, { inFlight: true, fault: 'stale' });
    await page.waitForTimeout(2300);
    expect(await status()).toContain('No data');
    expect(await text(page, '.fh-display .fh-readout')).toBe('--- kt');
    await sim(page, { fault: 'none', iasKt: 30 });
    await settle(page, 700);
    const readoutClass = (c: string) => page.$eval('.fh-display .fh-readout', (e, cls) => e.classList.contains(cls), c);
    expect(await readoutClass('low')).toBe(true);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-state-low.png` });
    await sim(page, { iasKt: 200 });
    await settle(page, 700);
    expect(await readoutClass('low')).toBe(false);
    expect(await readoutClass('fast')).toBe(true);
    await sim(page, { iasKt: 80, onGround: true });
    await settle(page, 400);
    expect(await page.$eval('.fh-display .fh-marker', (e) => (e as HTMLElement).style.display)).toBe('none');
    await page.close();
  });

  it('incomplete profile: message, cells, and the current flap still work', async () => {
    const page = await env.newPage('?seed=none');
    const p = makeProfile(6);
    const labels = ['5', 'N', '4', '3', '2', '1'];
    p.flaps.forEach((f, i) => {
      f.label = labels[i];
      f.handle_index = 5 - i;
    });
    p.vne = null;
    await load(page, p);
    await sim(page, { flapCount: 8, flapIndex: 5, iasKt: 80 });
    await settle(page, 500);
    expect(await text(page, '.fh-display .fh-barmsg')).toBe('profile incomplete: open settings');
    expect(await page.$$eval('.fh-display .fh-cell', (e) => e.length)).toBe(6);
    expect(await page.$$eval('.fh-display .fh-cell.current', (e) => e.map((x) => x.textContent))).toEqual(['5']);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-state-incomplete-as33.png` });
    await page.close();
  });

  it('N = 0 shows "no flaps"', async () => {
    const page = await env.newPage('?seed=demo');
    const p = makeProfile(0);
    p.weight_kg = { light: 400, heavy: 600 };
    p.vs_min = { no_ballast_kt: 40, max_ballast_kt: 40 };
    p.vne = 120;
    await load(page, p);
    await sim(page, { iasKt: 80 });
    await settle(page, 400);
    expect(await text(page, '.fh-display .fh-noflaps')).toBe('no flaps');
    expect(await text(page, '.fh-display .fh-status')).toContain('no flaps');
    await page.close();
  });
});


describe('read-only weight', () => {
  it('displays real weight while clamping the thumb, ignores clicks, and clears stale values', async () => {
    const page = await env.newPage('?seed=demo');
    await load(page, makeProfile(6));
    const read = () => page.$eval('.fh-display .fh-sl-pct', (e) => e.textContent);
    const thumb = () => page.$eval('.fh-display .fh-sl-thumb', (e) => (e as HTMLElement).style.left);
    await sim(page, { totalWeightKg: 300 });
    expect(await read()).toBe('300 kg');
    expect(await thumb()).toBe('0%');
    await sim(page, { totalWeightKg: 700 });
    expect(await read()).toBe('700 kg');
    expect(await thumb()).toBe('100%');
    await page.click('.fh-display .fh-sl-track');
    expect(await read()).toBe('700 kg');
    await sim(page, { totalWeightKg: null });
    expect(await read()).toBe('-- kg');
    await sim(page, { totalWeightKg: 500 });
    expect(await read()).toBe('500 kg');
    await sim(page, { fault: 'stale' });
    await page.waitForTimeout(2100);
    expect(await read()).toBe('-- kg');
    await page.close();
  });
});
