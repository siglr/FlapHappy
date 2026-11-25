import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { SHOT_DIR, startEnv, type Env } from './browser-env';
import { createBlankProfile, exportProfileJson } from '../../core/profile';
import { makeProfile } from '../unit/helpers';

let env: Env;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  expect(env.errors).toEqual([]);
  await env.close();
});

const fieldSel = (path: string) => `.fh-settings [data-path="${path}"]`;
const fill = (page: Page, path: string, v: string) => page.fill(fieldSel(path), v);
const rowCount = (page: Page) => page.$$eval('.fh-settings .fh-frow', (e) => e.length);
const transCount = (page: Page) => page.$$eval('.fh-settings .fh-trow', (e) => e.length);
const validHead = (page: Page) => page.$eval('.fh-settings .fh-validhead', (e) => e.textContent);
const saveState = (page: Page) => page.$eval('.fh-settings .fh-savestate', (e) => e.textContent);
const sim = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((c) => {
    const w = window as any;
    Object.assign(w.__flapHappy.sim.controls, c);
    w.__flapHappy.sim.tick(0);
  }, patch);

describe('settings editor: build the AS 33 Me table from scratch', () => {
  it('blank profile, six rows with automatic N-1 transitions, valid, applied to the display, stored', async () => {
    const page = await env.newPage('?seed=none', { width: 1100, height: 1500 });
    // No profile yet: the editor opens by itself.
    await page.waitForSelector('.fh-settings');
    expect(await page.locator('.fh-pbar').textContent()).toContain('No profile yet');
    await page.click('.fh-new');
    await page.fill('.fh-new-name', 'New profile');
    await page.click('.fh-create');
    expect(await page.evaluate(async () => (await (window as any).__flapHappy.app.store.list()).length)).toBe(0);
    await page.waitForSelector('.fh-settings .fh-addrow');
    expect(await rowCount(page)).toBe(0);
    expect(await page.locator('.fh-profile-select').inputValue()).toBe('new-profile');
    expect(await page.$('.fh-settings .fh-name')).toBeNull();

    for (let n = 1; n <= 6; n++) {
      await page.click('.fh-settings .fh-addrow');
      expect(await rowCount(page)).toBe(n);
      expect(await transCount(page)).toBe(n - 1);
    }

    const labels = ['5', 'N', '4', '3', '2', '1'];
    for (let i = 0; i < 6; i++) await fill(page, `flaps[${i}].label`, labels[i]);
    for (let i = 0; i < 6; i++) await fill(page, `flaps[${i}].handle_index`, String(i));
    expect(await validHead(page)).toContain('Not applied: fix');
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-editor-incomplete.png`, fullPage: true });

    expect(await page.locator('.fh-weight-mode').inputValue()).toBe('manual');
    expect(await page.locator(fieldSel('weight_kg.light')).count()).toBe(0);
    await page.selectOption('.fh-weight-mode', 'live');
    expect(await page.locator('.fh-settings .fh-save').isDisabled()).toBe(true);
    await fill(page, 'weight_kg.light', '400');
    expect(await page.locator('.fh-settings .fh-save').isDisabled()).toBe(true);
    await fill(page, 'weight_kg.heavy', '600');
    await fill(page, 'vs_min.no_ballast_kt', '48');
    await fill(page, 'vs_min.max_ballast_kt', '56');
    const no = [62, 74, 86, 100, 118];
    const mx = [70, 83, 97, 113, 133];
    for (let k = 0; k < 5; k++) {
      await fill(page, `transitions[${k}].no_ballast_kt`, String(no[k]));
      await fill(page, `transitions[${k}].max_ballast_kt`, String(mx[k]));
    }
    await fill(page, 'vne', '145');
    expect(await validHead(page)).toMatch(/^Validation: Valid/);
    await page.click('.fh-settings .fh-save');
    await page.waitForFunction(() => document.querySelector('.fh-settings .fh-savestate')!.textContent === 'Saved and applied');

    const stored = await page.evaluate(async () => {
      const a = (window as any).__flapHappy.app;
      return a.store.load('new-profile');
    });
    expect(stored.schema).toBe('flaphappy.profile/3');
    expect(stored.flaps.map((f: any) => f.label)).toEqual(labels);
    // The user types each sim index. These rows were added in order, so 0..5.
    expect(stored.flaps.map((f: any) => f.handle_index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(stored.transitions).toHaveLength(5);
    expect(stored.vne).toBe(145);
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-editor-as33.png`, fullPage: true });

    await page.click('.fh-settings .fh-back');
    await page.evaluate(() => (window as any).__flapHappy.app.setBallast(0, true));
    await sim(page, { flapCount: 8, flapIndex: 1, iasKt: 90 });
    await page.waitForTimeout(500);
    expect(await page.$$eval('.fh-display .fh-cell', (e) => e.map((x) => x.textContent))).toEqual(labels);
    expect(await page.$$eval('.fh-display .fh-cell.current', (e) => e.map((x) => x.textContent))).toEqual(['N']);
    expect(await page.$$eval('.fh-display .fh-ticktext', (e) => e.map((x) => x.textContent))).toEqual(['48', '62', '74', '86', '100', '118', '145']);
    await page.close();
  });
});

describe('settings editor: row rules, validation, undo', () => {
  async function openWith(profileJson: unknown, size = { width: 1100, height: 1400 }) {
    const page = await env.newPage('?seed=none', size);
    await page.evaluate(async (p) => {
      const a = (window as any).__flapHappy.app;
      await a.store.save(p);
      await a.refreshMetas();
      await a.activate((p as any).id, true);
      a.closeSettings();
      a.openSettings();
    }, profileJson as any);
    await page.waitForSelector('.fh-mapping');
    if (!(await page.locator('.fh-mapping').evaluate((d: HTMLDetailsElement) => d.open))) await page.click('.fh-mapping summary');
    await page.waitForSelector('.fh-settings .fh-addrow');
    return page;
  }

  it('add / remove keep N-1 transitions; undo restores a deleted row', async () => {
    const page = await openWith(makeProfile(3, { id: 'rules' }));
    expect([await rowCount(page), await transCount(page)]).toEqual([3, 2]);
    await page.click('.fh-settings .fh-addrow');
    expect([await rowCount(page), await transCount(page)]).toEqual([4, 3]);
    // A prefilled transition is shown amber until edited.
    expect(await page.$$eval('.fh-settings .fh-trow.prefilled', (e) => e.length)).toBe(1);
    const labelsBefore = await page.$$eval('.fh-settings .fh-lbl[data-path^="flaps"]', (e) => e.map((x) => (x as HTMLInputElement).value));
    await page.locator('.fh-settings .fh-frow').nth(1).locator('.fh-remove').click();
    expect([await rowCount(page), await transCount(page)]).toEqual([3, 2]);
    await page.click('.fh-settings .fh-undo');
    expect([await rowCount(page), await transCount(page)]).toEqual([4, 3]);
    expect(await page.$$eval('.fh-settings .fh-lbl[data-path^="flaps"]', (e) => e.map((x) => (x as HTMLInputElement).value))).toEqual(labelsBefore);
    await page.close();
  });

  it('shows per-field errors and says "Not applied" while the display keeps the last valid profile', async () => {
    const page = await openWith(makeProfile(4, { id: 'invalid' }));
    await page.waitForTimeout(700);
    await page.evaluate(() => (window as any).__flapHappy.app.setBallast(0, true));
    await page.click('.fh-settings .fh-back');
    const ticks = () => page.$$eval('.fh-display .fh-ticktext', (e) => e.map((x) => x.textContent));
    const good = await ticks();
    expect(good).toEqual(['40', '52', '64', '76', '114']);
    await page.click('.fh-cog');
    await fill(page, 'transitions[2].no_ballast_kt', '62'); // below T2 (64)
    expect(await validHead(page)).toContain('Not applied: fix 1 error');
    expect(await page.$eval(fieldSel('transitions[2].no_ballast_kt'), (e) => e.classList.contains('err'))).toBe(true);
    expect(await page.$eval('.fh-settings .fh-issues li.error', (e) => e.textContent)).toBe('T3 (No Ballast) 62 must be above T2 (No Ballast) 64');
    await page.click('.fh-settings .fh-save');
    await page.waitForFunction(() => /Saved as incomplete/.test(document.querySelector('.fh-settings .fh-savestate')!.textContent || ''));
    await page.click('.fh-settings .fh-back');
    expect(await ticks()).toEqual(good);
    await page.click('.fh-cog');
    await fill(page, 'transitions[2].no_ballast_kt', '77');
    await page.click('.fh-settings .fh-save');
    await page.waitForFunction(() => document.querySelector('.fh-settings .fh-savestate')!.textContent === 'Saved and applied');
    await page.click('.fh-settings .fh-back');
    expect(await ticks()).toEqual(['40', '52', '64', '77', '114']);
    await page.close();
  });

  it('flap rows show only the label, sim index and remove; the live index is shown and its row marked', async () => {
    const page = await openWith(makeProfile(3, { id: 'live' }));
    expect(await page.$$eval('.fh-settings .fh-frow input, .fh-settings .fh-frow select', (e) => e.map((x) => x.getAttribute('data-path')))).toEqual(['flaps[0].label', 'flaps[0].handle_index', 'flaps[1].label', 'flaps[1].handle_index', 'flaps[2].label', 'flaps[2].handle_index']);
    expect(await page.locator('.fh-settings .fh-frow').nth(0).locator('button').evaluateAll((e) => e.map((x) => x.className))).toEqual(['fh-btn fh-remove']);
    expect(await page.$$eval('.fh-settings .fh-frow .fh-handle', (e) => e.map((x) => (x as HTMLInputElement).value))).toEqual(['0', '1', '2']);
    await sim(page, { flapCount: 4, flapIndex: 1 });
    await page.waitForTimeout(300);
    expect(await page.$eval('.fh-settings .fh-liveline', (e) => e.textContent)).toBe('Live: handle index 1 of 4 [flap "2"]');
    expect(await page.$$eval('.fh-settings .fh-frow.live', (e) => e.length)).toBe(1);
    await page.close();
  });

  it('dragging a row moves its label; the sim indexes and transition speeds stay put', async () => {
    const page = await openWith(makeProfile(3, { id: 'reorder' }));
    const labels = () => page.$$eval('.fh-settings .fh-lbl[data-path^="flaps"]', (e) => e.map((x) => (x as HTMLInputElement).value));
    const t1 = () => page.$eval(fieldSel('transitions[0].no_ballast_kt'), (e) => (e as HTMLInputElement).value);
    const before = await t1();
    const grip = (await page.locator('.fh-settings .fh-frow').nth(0).locator('.fh-grip').boundingBox())!;
    const dest = (await page.locator('.fh-settings .fh-frow').nth(2).boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 8 });
    const ghost = await page.evaluate(() => {
      const el = document.querySelector('.fh-dragghost') as HTMLElement | null;
      const input = el ? (el.querySelector('input') as HTMLInputElement | null) : null;
      return el ? { value: input ? input.value : '', opacity: getComputedStyle(el).opacity } : null;
    });
    expect(ghost && ghost.value).toBe('1');
    expect(Number(ghost && ghost.opacity)).toBeLessThan(1);
    const spacing = await page.$$eval('.fh-settings .fh-frow', (els) => els.map((el) => ({ open: (el as HTMLElement).style.marginTop, collapsed: el.classList.contains('fh-dragging') })));
    expect(spacing[0].collapsed).toBe(true);
    expect(parseInt(spacing[2].open, 10)).toBeGreaterThan(20);
    await page.mouse.up();
    expect(await page.$('.fh-dragghost')).toBeNull();
    expect(await labels()).toEqual(['2', '3', '1']);
    expect(await t1()).toBe(before);
    expect(await page.$eval('.fh-settings .fh-transname', (e) => e.textContent)).toBe('2 → 3');
    expect(await page.$$eval('.fh-settings .fh-frow .fh-handle', (e) => e.map((x) => (x as HTMLInputElement).value))).toEqual(['0', '1', '2']);
    await page.close();
  });

});

describe('profile library: presets, import and export', () => {
  it('lists local profiles at the top and prevents switching away from unsaved changes', async () => {
    const page = await env.newPage('?seed=demo', { width: 1100, height: 900 });
    await page.click('.fh-cog');
    await page.waitForSelector('.fh-profile-select');
    expect(await page.locator('.fh-profile-select').inputValue()).toBe('as33-18m');
    expect(await page.locator('.fh-profile-select option').count()).toBe(5);
    expect(await page.$eval('.fh-dev-count', (e) => (e as HTMLInputElement).value)).toBe('6');
    expect(await page.$eval('.fh-settings .fh-liveline', (e) => e.textContent)).toContain('of 6');
    await page.selectOption('.fh-profile-select', 'as33-15m');
    await page.waitForFunction(() => (window as any).__flapHappy.profileId() === 'as33-15m');
    expect(await page.locator('.fh-profile-select').inputValue()).toBe('as33-15m');
    expect(await page.locator('.fh-mapping').evaluate((e: HTMLDetailsElement) => e.open)).toBe(false);
    await page.click('.fh-new');
    await page.fill('.fh-new-name', 'as33-15m');
    await page.click('.fh-create');
    expect(await page.locator('.fh-new-form').textContent()).toContain('already exists');
    await page.fill('.fh-new-name', 'Another glider');
    await page.click('.fh-create');
    expect(await page.locator('.fh-profile-select').inputValue()).toBe('another-glider');
    expect(await page.locator('.fh-profile-select').isDisabled()).toBe(true);
    expect(await page.locator('.fh-new').isDisabled()).toBe(true);
    await page.click('.fh-discard-edits');
    expect(await page.locator('.fh-profile-select').inputValue()).toBe('as33-15m');
    expect(await page.locator('.fh-profile-select').isEnabled()).toBe(true);
    expect(await page.evaluate(async () => (await (window as any).__flapHappy.app.store.list()).length)).toBe(3);
    await page.close();
  });

  it('import lands as a draft the user must accept; an existing id is reused; bad files are rejected', async () => {
    const page = await env.newPage('?seed=demo', { width: 1100, height: 1000 });
    const good = exportProfileJson(makeProfile(3, { id: 'as33-18m' }));
    await page.click('.fh-cog');
    const chooserPromise = page.waitForEvent('filechooser');
    await page.selectOption('.fh-profile-select', ':custom');
    const chooser = await chooserPromise;
    await chooser.setFiles({name:'friend.flaphappy.json',mimeType:'application/json',buffer:Buffer.from(good)});
    await page.waitForSelector('.fh-settings .fh-importbox');
    expect(await page.$eval('.fh-settings .fh-importbox', (e) => e.textContent)).toContain('valid');
    expect((await page.evaluate(async () => (await (window as any).__flapHappy.app.store.list()).length))).toBe(3);
    await page.click('.fh-settings .fh-accept');
    await page.waitForFunction(() => (document.querySelector('.fh-profile-select') as HTMLSelectElement)?.value === 'as33-18m');
    const ids = await page.evaluate(async () => (await (window as any).__flapHappy.app.store.list()).map((m: { id: string }) => m.id));
    expect(ids).toContain('as33-18m');
    expect(ids).not.toContain('as33-18m-2');
    expect(ids).toHaveLength(3);

    const bad = JSON.parse(good);
    bad.transitions.pop();
    await page.evaluate((t) => (window as any).__flapHappy.app.importText(t, 'broken.json'), JSON.stringify(bad));
    await page.waitForSelector('.fh-settings .fh-importbox.bad');
    expect(await page.$eval('.fh-settings .fh-importbox.bad', (e) => e.textContent)).toContain('transitions');
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-editor-import-error.png`, fullPage: true });
    await page.close();
  });

  it('keeps reference and transition columns readable at common viewport widths', async () => {
    const page = await env.newPage('?seed=demo', {width:800,height:1000});
    await page.click('.fh-cog');
    await page.selectOption('.fh-weight-mode', 'live');
    await fill(page, 'weight_kg.light', '400');
    await fill(page, 'weight_kg.heavy', '600');
    for (const width of [800, 640, 533, 400]) {
      await page.setViewportSize({width,height:1000});
      const bounds = await page.evaluate(() => Array.from(document.querySelectorAll('.fh-transition-row')).map(row => {
        const label = row.querySelector('.fh-transname')!.getBoundingClientRect();
        const inputs = row.querySelectorAll('input');
        return { labelRight:label.right, left:inputs[0].getBoundingClientRect().left, leftRight:inputs[0].getBoundingClientRect().right,
          right:inputs[1].getBoundingClientRect().left, rightEnd:inputs[1].getBoundingClientRect().right };
      }));
      expect(bounds.length).toBeGreaterThan(0);
      for (const b of bounds) { expect(b.labelRight).toBeLessThanOrEqual(b.left); expect(b.leftRight).toBeLessThanOrEqual(b.right); expect(b.rightEnd).toBeLessThanOrEqual(width); }
      await page.screenshot({path:`${SHOT_DIR}/profiles-editor-${width}.png`, fullPage:true});
    }
    await page.close();
  });

  it('advanced settings apply to the live profile', async () => {
    const page = await env.newPage('?seed=demo', { width: 1100, height: 1400 });
    await page.click('.fh-cog');
    await page.click('.fh-advanced summary');
    await page.fill('.fh-advanced input >> nth=0', '400');
    await page.click('.fh-settings .fh-save');
    await page.waitForFunction(() => document.querySelector('.fh-settings .fh-savestate')!.textContent === 'Saved and applied');
    expect(await page.evaluate(() => (window as any).__flapHappy.app.profile.marker_smoothing_ms)).toBe(400);
    await page.close();
  });

  it('demo mode toggle and window settings are available in the editor', async () => {
    const page = await env.newPage('?seed=demo', { width: 1100, height: 1000 });
    await page.click('.fh-cog');
    await page.click('.fh-appbox summary');
    expect(await page.$eval('.fh-appbox', (e) => e.textContent)).toContain('Demo mode');
    await page.screenshot({ path: `${SHOT_DIR}/flaphappy-editor-top.png` });
    await page.close();
  });
});
