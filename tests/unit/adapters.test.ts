import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProfileStore } from '../../adapters/electron/file-store';
import { MemoryProfileStore } from '../../adapters/simulated/memory-store';
import { SimulatedSource, FAULTS } from '../../adapters/simulated/simulated-source';
import { ScenarioPlayer, scenarioDuration, type Scenario } from '../../adapters/simulated/scenario';
import { ReplaySource, parseTraceJsonl } from '../../adapters/simulated/replay-source';
import { parseCli } from '../../app-electron/cli';
import { defaultSettings } from '../../core/settings';
import { exportProfileJson } from '../../core/profile';
import { makeProfile, sample } from './helpers';
import { PRESETS } from '../../profiles';
import { CurrentFlapResolver } from '../../core/flapmap';
import { buildDisplayModel } from '../../core/display-model';
import { validateProfile } from '../../core/validate';
import { effectiveBoundaries } from '../../core/scale';
import type { SimSample } from '../../core/sim';
import iasSweep from '../../adapters/simulated/scenarios/ias-sweep.json';
import soak from '../../adapters/simulated/scenarios/combined-soak.json';
import lever from '../../adapters/simulated/scenarios/lever-sequence.json';
import connectCycle from '../../adapters/simulated/scenarios/connect-cycle.json';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flaphappy-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('FileProfileStore (real JSON files)', () => {
  it('saves one file per profile and reloads the same profile after a "restart"', async () => {
    const a = new FileProfileStore(dir);
    const p = makeProfile(6, { id: 'as33-test' });
    await a.save(p);
    expect(fs.existsSync(path.join(dir, 'profiles', 'as33-test.json'))).toBe(true);
    const b = new FileProfileStore(dir);
    expect(exportProfileJson(await b.load('as33-test'))).toEqual(exportProfileJson(p));
    const list = await b.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'as33-test', incomplete: false, source: 'user' });
  });

  it('writes atomically and keeps one .bak of the previous version', async () => {
    const s = new FileProfileStore(dir);
    const p = makeProfile(2, { id: 'x' });
    await s.save(p);
    p.notes = 'Second';
    await s.save(p);
    const file = path.join(dir, 'profiles', 'x.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).notes).toBe('Second');
    expect(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).notes).toBe('');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).display_name).toBeUndefined();
    expect(fs.existsSync(file + '.tmp')).toBe(false);
  });

  it('saves incomplete drafts and flags them in the library', async () => {
    const s = new FileProfileStore(dir);
    const draft = makeProfile(2, { id: 'draft' });
    draft.vs_min.no_ballast_kt = null;
    await s.save(draft);
    const meta = (await s.list())[0];
    expect(meta.incomplete).toBe(true);
  });

  it('survives a corrupt file without losing the rest of the library', async () => {
    const s = new FileProfileStore(dir);
    await s.save(makeProfile(2, { id: 'good' }));
    fs.writeFileSync(path.join(dir, 'profiles', 'bad.json'), '{ not json');
    const list = await s.list();
    expect(list.map((m) => m.id).sort()).toEqual(['bad', 'good']);
    expect(list.find((m) => m.id === 'bad')?.error).toBeTruthy();
  });

  it('remove keeps a recoverable backup instead of deleting', async () => {
    const s = new FileProfileStore(dir);
    await s.save(makeProfile(2, { id: 'gone' }));
    await s.remove('gone');
    expect(await s.list()).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'profiles', 'gone.json.deleted.bak'))).toBe(true);
  });

  it('refuses path traversal in ids', async () => {
    const s = new FileProfileStore(dir);
    await expect(s.load('../../etc/passwd')).rejects.toThrow();
    const p = makeProfile(1, { id: '../escape' });
    await s.save(p);
    expect(fs.existsSync(path.join(dir, 'escape.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'profiles', 'escape.json'))).toBe(true);
  });

  it('persists settings and keeps window bounds owned by the main process', async () => {
    const a = new FileProfileStore(dir);
    expect((await a.getSettings())).toEqual(defaultSettings());
    a.setWindowBounds({ x: 10, y: 20, width: 700, height: 500 });
    a.setMainWindowBounds({ x: 30, y: 40, width: 800, height: 600 });
    const s = await a.getSettings();
    s.ballast_by_profile.p = 0.6;
    s.ui.always_on_top = true;
    s.ui.external_panel_on_launch = true;
    s.window = null;
    s.main_window = null;
    await a.setSettings(s);
    const b = new FileProfileStore(dir);
    const loaded = await b.getSettings();
    expect(loaded.ballast_by_profile.p).toBe(0.6);
    expect(loaded.ui.always_on_top).toBe(true);
    expect(loaded.ui.external_panel_on_launch).toBe(true);
    expect(loaded.main_window).toEqual({ x: 30, y: 40, width: 800, height: 600 });
    expect(loaded.window).toEqual({ x: 10, y: 20, width: 700, height: 500 });
  });

  it('recovers from a corrupt settings.json', async () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), 'garbage');
    expect(await new FileProfileStore(dir).getSettings()).toEqual(defaultSettings());
  });
});

describe('MemoryProfileStore', () => {
  it('copies on save and load', async () => {
    const s = new MemoryProfileStore();
    const p = makeProfile(2, { id: 'm' });
    await s.save(p);
    p.notes = 'mutated';
    expect((await s.load('m')).notes).toBe('');
    await s.remove('m');
    await expect(s.load('m')).rejects.toThrow();
  });
});

describe('SimulatedSource', () => {
  const make = () => {
    let now = 0;
    const src = new SimulatedSource(() => now);
    const out: SimSample[] = [];
    src.controls.flapCount = 6;
    (src as unknown as { cb: (s: SimSample) => void }).cb = (s) => out.push(s);
    return { src, out, advance: (ms: number) => { now += ms; src.tick(ms); } };
  };

  it('reports a full normalised sample', () => {
    const { src, out, advance } = make();
    src.controls.flapIndex = 2;
    src.controls.iasKt = 77;
    advance(100);
    expect(out[0]).toMatchObject({ connected: true, inFlight: true, iasKt: 77, flapIndex: 2, flapCount: 6, onGround: false });
    expect(out[0].flapPercent).toBeCloseTo(2 / 5, 8);
  });

  it('every fault removes exactly the intended readings', () => {
    const { src, out, advance } = make();
    src.controls.flapIndex = 2;
    src.lvarEnabled = true;
    const run = (f: (typeof FAULTS)[number]) => {
      src.controls.fault = f;
      out.length = 0;
      advance(100);
      return out[0];
    };
    expect(run('none')).toMatchObject({ flapIndex: 2, lvar: 2 });
    expect(run('index-missing').flapIndex).toBeNull();
    expect(run('index-missing').flapPercent).not.toBeNull();
    expect(run('index-out-of-range').flapIndex).toBeGreaterThanOrEqual(6);
    const pct = run('percent-only');
    expect(pct.flapIndex).toBeNull();
    expect(pct.flapPercent).not.toBeNull();
    expect(run('lvar-only')).toMatchObject({ flapIndex: null, flapPercent: null, lvar: 2 });
    const un = run('unreadable');
    expect([un.flapIndex, un.flapPercent, un.lvar]).toEqual([null, null, null]);
    expect(run('stale')).toBeUndefined();
  });

  it('disconnected emits connected = false', () => {
    const { src, out, advance } = make();
    src.controls.connected = false;
    advance(100);
    expect(out[0]).toMatchObject({ connected: false, iasKt: null });
  });
});

describe('scenarios', () => {
  const ctx = { vs: 40, vne: 100, rowHandles: [0, 1, 2, 3] };

  it('IAS sweep covers below Vs through above Vne (profile-relative)', () => {
    const pl = new ScenarioPlayer(iasSweep as unknown as Scenario, ctx);
    expect(pl.at(0).iasKt).toBe(28);
    expect(pl.at(40).iasKt).toBe(112);
    expect(pl.at(20).iasKt).toBeCloseTo(70, 5);
    expect(pl.at(80 + 40).iasKt).toBe(112); // loops
  });

  it('lever sequence steps slow to fast and back, clamped to the profile rows', () => {
    const pl = new ScenarioPlayer(lever as unknown as Scenario, ctx);
    expect(pl.at(0).flapIndex).toBe(0);
    expect(pl.at(10).flapIndex).toBe(3);
    expect(pl.at(33).flapIndex).toBe(3);
    expect(pl.at(66).flapIndex).toBe(0);
  });

  it('connect cycle toggles connection and ground state', () => {
    const pl = new ScenarioPlayer(connectCycle as unknown as Scenario, ctx);
    expect(pl.at(1).connected).toBe(true);
    expect(pl.at(9).connected).toBe(false);
    expect(pl.at(15).connected).toBe(true);
    expect(pl.at(21).inFlight).toBe(false);
    expect(pl.at(31).onGround).toBe(true);
    expect(pl.at(41).fault).toBe('stale');
  });

  it('interpolates ballast and honours duration', () => {
    const sc: Scenario = { name: 't', duration: 10, keyframes: [{ t: 0, ballast: 0 }, { t: 5, ballast: 1 }] };
    const pl = new ScenarioPlayer(sc, ctx);
    expect(pl.at(2.5).ballast).toBeCloseTo(0.5, 8);
    expect(pl.at(50).ballast).toBe(1);
    expect(scenarioDuration(sc)).toBe(10);
  });

  it('20 minute soak: the full pipeline stays finite, consistent and single-highlight', () => {
    const profile = PRESETS[0].profile;
    const valid = validateProfile(profile);
    expect(valid.ok).toBe(true);
    let now = 0;
    const src = new SimulatedSource(() => now);
    src.controls.flapCount = 6;
    const resolver = new CurrentFlapResolver();
    const pl = new ScenarioPlayer(soak as unknown as Scenario, { vs: profile.vs_min.no_ballast_kt as number, vne: profile.vne as number, rowHandles: profile.flaps.map((r) => r.handle_index as number) });
    let seen = 0;
    let ballast = 0;
    let last: SimSample | null = null;
    (src as unknown as { cb: (s: SimSample) => void }).cb = (s) => (last = s);
    const steps = (20 * 60 * 1000) / 100;
    for (let i = 0; i < steps; i++) {
      now += 100;
      const out = pl.at(now / 1000);
      if (out.connected !== undefined) src.controls.connected = out.connected;
      if (out.iasKt !== undefined) src.controls.iasKt = out.iasKt;
      if (out.flapIndex !== undefined) src.controls.flapIndex = out.flapIndex;
      if (out.fault !== undefined) src.controls.fault = out.fault;
      if (out.ballast !== undefined) ballast = out.ballast;
      last = null;
      src.tick(100);
      const s = last as SimSample | null;
      if (!s) continue;
      const flap = resolver.resolve(profile, s, now);
      const model = buildDisplayModel({ profile, validation: valid, sample: { ...s, totalWeightKg: 400 + ballast * 200 }, link: s.connected ? 'live' : 'waiting', ias: s.iasKt, flap });
      seen++;
      expect(model.cells.filter((c) => c.state === 'current').length).toBeLessThanOrEqual(1);
      if (model.marker.pos !== null) expect(model.marker.pos).toBeGreaterThanOrEqual(0);
      if (model.marker.pos !== null) expect(model.marker.pos).toBeLessThanOrEqual(1);
      const b = effectiveBoundaries(profile, ballast)!;
      expect(b.every((x) => isFinite(x))).toBe(true);
      expect(model.iasText).not.toMatch(/NaN/);
    }
    expect(seen).toBeGreaterThan(steps * 0.8);
  });
});

describe('ReplaySource and trace files', () => {
  it('parses jsonl, skipping a torn last line', () => {
    const text = [JSON.stringify(sample({ t: 1 })), JSON.stringify(sample({ t: 2 })), '{"t": 3, "conn'].join('\n');
    expect(parseTraceJsonl(text).map((s) => s.t)).toEqual([1, 2]);
  });

  it('replays samples in order', async () => {
    const got: number[] = [];
    const r = new ReplaySource([sample({ t: 0 }), sample({ t: 5 }), sample({ t: 10 })], { speed: 100 });
    await new Promise<void>((resolve) => {
      r.start((s) => {
        got.push(s.t);
        if (got.length === 3) resolve();
      });
    });
    r.stop();
    expect(got).toEqual([0, 5, 10]);
  });
});

describe('command line', () => {
  it('parses source, record, trace and flags', () => {
    const c = parseCli(['x', '--source=simulated', '--record', 'a.jsonl', '--trace=b.jsonl', '--speed=4', '--compact', '--protocol=KittyHawk']);
    expect(c).toMatchObject({ source: 'simulated', dev: true, record: 'a.jsonl', trace: 'b.jsonl', speed: 4, compact: true, protocol: 'KittyHawk' });
  });
  it('defaults to the real sim without the dev panel', () => {
    expect(parseCli([])).toMatchObject({ source: 'simconnect', dev: false, record: null, protocol: 'SunRise', smoke: false });
    expect(parseCli(['--dev']).dev).toBe(true);
  });
});
