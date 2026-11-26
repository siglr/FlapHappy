import { describe, expect, it } from 'vitest';
import { buildDisplayModel, deriveLink, STALE_MS } from '../../core/display-model';
import { CurrentFlapResolver } from '../../core/flapmap';
import { validateProfile } from '../../core/validate';
import { createBlankProfile } from '../../core/profile';
import { effectiveBoundaries } from '../../core/scale';
import { initialBallast, ballastReadout, snapFraction } from '../../core/ballast';
import { defaultSettings, normalizeSettings } from '../../core/settings';
import { heightToMetres, metresToHeight } from '../../core/units';
import { selectProfileId } from '../../core/select';
import { makeProfile, sample } from './helpers';
import type { SimSample } from '../../core/sim';
import { SETTINGS_SCHEMA, type Profile, type ProfileMeta } from '../../core/types';

function model(p: Profile | null, s: SimSample | null, f = 0, link = 'live' as 'live' | 'waiting' | 'nodata' | 'paused', ias?: number | null) {
  const v = p ? validateProfile(p) : null;
  const flap = p ? new CurrentFlapResolver().resolve(p, s, 1000) : ({ status: 'unknown', rowIndex: null, label: null, handleIndex: null, via: null } as const);
  return buildDisplayModel({ profile: p, validation: v, sample: s ? { ...s, totalWeightKg: 400 + f * 200 } : null, link, ias: ias ?? null, flap });
}

describe('display model', () => {
  it('simple guidance recommends by profile order, not flap label or handle index', () => {
    const p = makeProfile(6);
    ['L', '6', '5', 'N', '4-3', '1'].forEach((label, i) => { p.flaps[i].label = label; p.flaps[i].handle_index = 5-i; });
    const at = (iasKt: number) => model(p, sample({ flapIndex: 2, flapCount: 6, iasKt })).simple;
    expect(at(70)).toEqual({ current: 'N', suggestion: { label: '5', direction: 'slower' } });
    expect(at(94)).toEqual({ current: 'N', suggestion: { label: '4-3', direction: 'faster' } });
    expect(at(82)).toEqual({ current: 'N', suggestion: null });
    expect(at(88).suggestion).toEqual({ label: '4-3', direction: 'faster' });
    expect(at(20).suggestion).toEqual({label:'L',direction:'slower'});
    expect(at(0).suggestion).toEqual({label:'L',direction:'slower'});
    expect(at(200).suggestion).toBeNull();
  });

  it('simple guidance clears invalid recommendations and uses raw IAS consistently in both views', () => {
    const p = makeProfile(6);
    const s = sample({ flapIndex: 3, flapCount: 6, iasKt: 94 });
    expect(model(p, s, 0, 'live', 65).simple).toEqual(model(p, s, 0, 'live').simple);
    expect(model(p, sample({ ...s, onGround: true })).simple.suggestion).toBeNull();
    expect(model(p, sample({ ...s, iasKt: null }), 0, 'live', 94).simple.suggestion).toBeNull();
    expect(model(p, sample({ ...s, flapIndex: null, flapPercent: null })).simple.suggestion).toBeNull();
    expect(model(p, s, 0, 'nodata').simple).toEqual({ current: null, suggestion: null });
    expect(model(p, s, 0, 'paused').simple.suggestion).toBeNull();
    expect(model(makeProfile(0), s).simple.suggestion).toBeNull();
    p.transitions[0].no_ballast_kt = null;
    expect(model(p, s).simple.suggestion).toBeNull();
  });

  it('has N cells, N + 1 ticks, and exactly one current cell for N = 1, 2, 6, 10', () => {
    for (const n of [1, 2, 6, 10]) {
      const p = makeProfile(n);
      for (let row = 0; row < n; row++) {
        const m = model(p, sample({ flapIndex: row, flapCount: n, iasKt: 60 }));
        expect(m.cells).toHaveLength(n);
        expect(m.ticks).toHaveLength(n + 1);
        expect(m.edges).toHaveLength(n + 1);
        expect(m.cells.filter((c) => c.state === 'current')).toHaveLength(1);
        expect(m.currentRow).toBe(row);
      }
    }
  });

  it('highlights only the current flap even when the marker is over another column', () => {
    const p = makeProfile(6);
    const b = effectiveBoundaries(p, 0)!;
    const m = model(p, sample({ flapIndex: 1, flapCount: 6, iasKt: (b[4] + b[5]) / 2 }));
    expect(m.currentRow).toBe(1);
    expect(m.marker.pos).toBeGreaterThan(m.edges![4]);
    expect(m.marker.pos).toBeLessThan(m.edges![5]);
  });

  it('ticks follow the ballast fraction', () => {
    const p = makeProfile(2);
    expect(model(p, sample({ flapCount: 2 }), 0).ticks).toEqual(['40', '52', '82']);
    expect(model(p, sample({ flapCount: 2 }), 1).ticks).toEqual(['50', '66', '82']);
  });

  it('FLAP ? badge when unreadable, with the bar and marker still working', () => {
    const p = makeProfile(3);
    const m = model(p, sample({ flapIndex: null, flapPercent: null, flapCount: 3, iasKt: 60 }));
    expect(m.badge).toEqual({ kind: 'unknown', text: 'FLAP ?' });
    expect(m.currentRow).toBeNull();
    expect(m.cells.every((c) => c.state === 'other')).toBe(true);
    expect(m.marker.pos).not.toBeNull();
  });

  it('an index that is not on a row shows #index and no highlighted cell', () => {
    const p = makeProfile(3);
    const m = model(p, sample({ flapIndex: 3, flapCount: 4, iasKt: 60 }));
    expect(m.badge).toEqual({ kind: 'other', text: '#3' });
    expect(m.cells.filter((c) => c.state === 'current')).toHaveLength(0);
  });

  it('off-scale IAS pins the marker and raises LOW / FAST', () => {
    const p = makeProfile(3);
    const lowInFlight = model(p, sample({ iasKt: 30, flapCount: 3 }));
    expect(lowInFlight.marker.pos).toBe(0);
    expect(lowInFlight.alert).toBe('LOW');
    const fast = model(p, sample({ iasKt: 200, flapCount: 3 }));
    expect(fast.marker.pos).toBe(1);
    expect(fast.alert).toBe('FAST');
  });

  it('greys the bar and hides the marker on the ground or below 25 kt', () => {
    const p = makeProfile(3);
    expect(model(p, sample({ onGround: true, iasKt: 60, flapCount: 3 })).marker).toEqual({ pos: null, region: null, greyed: true });
    expect(model(p, sample({ iasKt: 10, flapCount: 3 })).marker.greyed).toBe(true);
  });

  it('link states: waiting, no data, paused', () => {
    const p = makeProfile(3);
    expect(model(null, null, 0, 'waiting').statusText).toBe('Waiting for MSFS...');
    expect(model(p, sample(), 0, 'nodata').statusText).toBe('No data');
    expect(model(p, sample(), 0, 'nodata').iasText).toBe('--- kt');
    expect(model(p, sample({ inFlight: false }), 0, 'paused').statusText).toMatch(/Paused/);
    expect(model(p, sample(), 0, 'waiting').currentRow).toBeNull();
  });

  it('deriveLink: stale data becomes no data after 1.5 s', () => {
    const s = sample();
    expect(deriveLink(null, 0, 0)).toBe('waiting');
    expect(deriveLink(sample({ connected: false }), 0, 0)).toBe('waiting');
    expect(deriveLink(s, 1000, 1000 + STALE_MS)).toBe('live');
    expect(deriveLink(s, 1000, 1000 + STALE_MS + 1)).toBe('nodata');
    expect(deriveLink(sample({ inFlight: false }), 1000, 1100)).toBe('paused');
  });

  it('incomplete profile: no bar, message, but cells and the current flap still work', () => {
    const p = makeProfile(6);
    p.vs_min.no_ballast_kt = null;
    const m = model(p, sample({ flapIndex: 0, flapCount: 6 }));
    expect(m.mode).toBe('incomplete');
    expect(m.barVisible).toBe(false);
    expect(m.incompleteMessage).toBe('profile incomplete: open settings');
    expect(m.currentRow).toBe(0);
    expect(m.cells.filter((c) => c.state === 'current')).toHaveLength(1);
  });

  it('N = 0 is "no flaps" with an unsegmented bar when Vs and Vne are set', () => {
    const p = createBlankProfile();
    p.weight_kg = { light: 400, heavy: 600 };
    p.vs_min = { no_ballast_kt: 40, max_ballast_kt: 40 };
    p.vne = 120;
    const m = model(p, sample({ iasKt: 80 }));
    expect(m.mode).toBe('noflaps');
    expect(m.cells).toHaveLength(0);
    expect(m.barVisible).toBe(true);
    expect(m.edges).toEqual([0, 1]);
    expect(m.marker.pos).toBeCloseTo(0.5, 5);
    for(const speed of [19,0]){
      const low=model(p,sample({iasKt:speed,flapCount:0,flapIndex:0}));
      expect(low.recommendedRow).toBeNull();expect(low.simple.suggestion).toBeNull();
    }
  });

  it('shows raw IAS in the readout and the smoothed value drives the marker', () => {
    const p = makeProfile(2);
    const m = model(p, sample({ iasKt: 104.2, flapCount: 2 }), 0, 'live', 46);
    expect(m.iasText).toBe('104 kt');
    expect(m.marker.pos).toBeCloseTo((46 - 40) / (82 - 40), 8);
  });

  it('shows raw height in the readout and the smoothed height drives the bar', () => {
    const p = makeProfile(2);
    const m = buildDisplayModel({
      profile: p,
      validation: validateProfile(p),
      sample: sample({ aglFt: 600, flapCount: 2 }),
      link: 'live',
      manualBallast: 0,
      ias: null,
      aglFt: 200,
      flap: new CurrentFlapResolver().resolve(p, sample({ flapCount: 2 }), 1000),
    });
    expect(m.aglText).toBe('600 ft');
    expect(m.aglPos).toBe(0);
    expect(m.aglInBand).toBe(false);
  });

  it('km/h converts the readout and the tick numbers from knots', () => {
    const p = makeProfile(2);
    const m = buildDisplayModel({
      profile: p,
      validation: validateProfile(p),
      sample: sample({ iasKt: 100, flapCount: 2 }),
      link: 'live',
      ias: null,
      flap: new CurrentFlapResolver().resolve(p, sample({ iasKt: 100, flapCount: 2 }), 1000),
      units: 'kmh',
    });
    expect(m.iasText).toBe('185 km/h');
    expect(m.ticks![0]).toBe(String(Math.round(40 * 1.852)));
    expect(m.aglText).toBe('--- ft');
    expect(m.aglPos).toBeNull();
  });

  it('scales height from 200 ft to 1000 ft and turns green from 400 ft to 800 ft', () => {
    const p = makeProfile(2);
    const at = (ft: number) => model(p, sample({ aglFt: ft, flapCount: 2 }));
    expect(at(100).aglPos).toBe(0);
    expect(at(100).aglInBand).toBe(false);
    expect(at(200).aglPos).toBe(0);
    expect(at(400).aglText).toBe('400 ft');
    expect(at(400).aglPos).toBeCloseTo(0.25, 5);
    expect(at(400).aglInBand).toBe(true);
    expect(at(600).aglPos).toBeCloseTo(0.5, 5);
    expect(at(600).aglInBand).toBe(true);
    expect(at(800).aglPos).toBeCloseTo(0.75, 5);
    expect(at(800).aglInBand).toBe(true);
    expect(at(900).aglInBand).toBe(false);
    expect(at(900).aglPos).toBeCloseTo(0.875, 5);
    expect(at(2500).aglText).toBe('2500 ft');
    expect(at(2500).aglPos).toBe(1);
    expect(at(600).aglMarks).toEqual(['400', '600', '800']);
    const metric = buildDisplayModel({
      profile: p,
      validation: validateProfile(p),
      sample: sample({ aglFt: 1000, flapCount: 2 }),
      link: 'live',
      manualBallast: 0,
      ias: null,
      flap: new CurrentFlapResolver().resolve(p, sample({ flapCount: 2 }), 1000),
      units: 'kmh',
      height: 'm',
    });
    expect(metric.aglText).toBe('305 m');
    expect(metric.aglPos).toBe(1);
    expect(metric.aglInBand).toBe(false);
    expect(metric.aglMarks).toEqual(['122', '183', '244']);
    const waiting = model(p, sample({ aglFt: 600, flapCount: 2 }), 0, 'waiting');
    expect(waiting.aglText).toBe('--- ft');
    expect(waiting.aglPos).toBeNull();
    expect(waiting.aglInBand).toBe(false);
    expect(at(600).windText).toBe('--- kt');
    expect(model(p, sample({ windKt: 12, flapCount: 2 })).windText).toBe('12 kt');
    const windMetric = buildDisplayModel({
      profile: p,
      validation: validateProfile(p),
      sample: sample({ windKt: 10, flapCount: 2 }),
      link: 'live',
      manualBallast: 0,
      ias: null,
      flap: new CurrentFlapResolver().resolve(p, sample({ flapCount: 2 }), 1000),
      units: 'kmh',
    });
    expect(windMetric.windText).toBe('19 km/h');
  });

  it('uses Bottom, Top, Low and High for the height bar', () => {
    const p = makeProfile(2);
    const agl = { bottom_m: 0, top_m: 152.4, low_m: 91.44, high_m: 30.48 };
    const at = (ft: number) =>
      buildDisplayModel({
        profile: p,
        validation: validateProfile(p),
        sample: sample({ aglFt: ft, flapCount: 2 }),
        link: 'live',
        manualBallast: 0,
        ias: null,
        flap: new CurrentFlapResolver().resolve(p, sample({ flapCount: 2 }), 1000),
        agl,
      });
    expect(at(0).aglPos).toBe(0);
    expect(at(250).aglPos).toBeCloseTo(0.5, 5);
    expect(at(250).aglInBand).toBe(true);
    expect(at(50).aglInBand).toBe(false);
    expect(at(400).aglInBand).toBe(false);
    expect(at(600).aglPos).toBe(1);
    expect(at(200).aglMarks).toEqual(['100', '200', '300']);
    expect(at(200).aglMarkPos[0]).toBeCloseTo(0.2, 5);
    expect(at(200).aglMarkPos[2]).toBeCloseTo(0.6, 5);
    const outside = { bottom_m: 0, top_m: 121.92, low_m: 152.4, high_m: 243.84 };
    const hidden = buildDisplayModel({
      profile: p,
      validation: validateProfile(p),
      sample: sample({ aglFt: 200, flapCount: 2 }),
      link: 'live',
      manualBallast: 0,
      ias: null,
      flap: new CurrentFlapResolver().resolve(p, sample({ flapCount: 2 }), 1000),
      agl: outside,
    });
    expect(hidden.aglInBand).toBe(false);
    expect(hidden.aglMarkPos).toEqual([null, null, null]);
    expect(heightToMetres(200, 'ft')).toBe(60.96);
    expect(metresToHeight(60.96, 'ft')).toBe(200);
    expect(metresToHeight(60.96, 'm')).toBe(61);
    expect(heightToMetres(61, 'm')).toBe(61);
  });
});

describe('ballast state, settings and selection', () => {
  it('snaps and clamps the fraction', () => {
    expect(snapFraction(0.52, 0.05)).toBeCloseTo(0.5, 10);
    expect(snapFraction(1.4, 0.05)).toBe(1);
    expect(snapFraction(-1, 0.05)).toBe(0);
    expect(snapFraction(0.123, 0)).toBeCloseTo(0.123, 10);
  });

  it('starts at the last saved ballast, or the default when none is saved', () => {
    const p = makeProfile(2);
    expect(initialBallast(p, undefined)).toEqual({ f: 1, unconfirmed: true, restored: false });
    expect(initialBallast(p, 0.6)).toEqual({ f: 0.6, unconfirmed: true, restored: true });
    p.ballast.default_fraction = 0.25;
    expect(initialBallast(p, undefined).f).toBe(0.25);
    expect(initialBallast(p, 0.6).f).toBe(0.6);
  });

  it('readout shows percent and optional litres', () => {
    const p = makeProfile(2);
    expect(ballastReadout(p, 0.6)).toBe('60%');
    p.ballast.max_ballast_litres = 200;
    expect(ballastReadout(p, 0.6)).toBe('60% 120 L');
  });

  it('normalises settings tolerantly', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    const s = normalizeSettings({ schema: SETTINGS_SCHEMA, ballast_by_profile: { a: 3, b: 'x' }, ui: { opacity: 0.1, zoom: 9, compact: true }, window: { x: 1, y: 2, width: 3, height: 4 }, active_by_title: { t: 'p', u: 4 } });
    expect(s.ballast_by_profile).toEqual({ a: 1 });
    expect(s.ui.simple_flap).toBe(false);
    expect(s.ui).toMatchObject({ opacity: 0.3, zoom: 3, compact: true, show_ballast: true, show_agl: true, show_transitions: false, show_wind: true, bar_shading: true });
    expect(normalizeSettings({ schema: SETTINGS_SCHEMA, ui: { bar_shading: false } }).ui.bar_shading).toBe(false);
    expect(normalizeSettings({ schema: SETTINGS_SCHEMA, ui: { show_ballast: false, show_agl: false } }).ui).toMatchObject({ show_ballast: false, show_agl: false });
    expect(s.window).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(s.active_by_title).toEqual({ t: 'p' });
    expect(normalizeSettings({ schema: SETTINGS_SCHEMA, units: 'kmh' }).units).toBe('kmh');
    expect(normalizeSettings({ schema: SETTINGS_SCHEMA, units: 'kmh' }).height).toBe('m');
    expect(normalizeSettings({ schema: SETTINGS_SCHEMA, units: 'kmh', height: 'ft' }).height).toBe('ft');
    expect(normalizeSettings({ schema: SETTINGS_SCHEMA, units: 'mph' }).units).toBe('kt');
    expect(normalizeSettings({ schema: SETTINGS_SCHEMA, agl: { bottom_m: 0, top_m: 99999, low_m: 'x' } }).agl).toEqual({ bottom_m: 0, top_m: 18288, low_m: 121.92, high_m: 243.84 });
    expect(normalizeSettings({ schema: SETTINGS_SCHEMA, agl: { bottom_ft: 200, top_ft: 1000 } }).agl.bottom_m).toBe(60.96);
    expect(normalizeSettings({ schema: 'flaphappy.settings/0', units: 'kmh' })).toEqual(defaultSettings());
  });

  it('auto-selects by remembered choice, then title match, then last used', () => {
    const m = (id: string, match: string[], incomplete = false): ProfileMeta => ({ id, filename: id + '.json', incomplete, match, source: 'user' });
    const metas = [m('a', ['AS 33'], true), m('b', ['AS 33']), m('c', ['JS3'])];
    const st = defaultSettings();
    expect(selectProfileId(metas, st, 'Got Friends AS 33 Me')).toBe('b');
    st.active_by_title['Got Friends AS 33 Me'] = 'a';
    expect(selectProfileId(metas, st, 'Got Friends AS 33 Me')).toBe('a');
    expect(selectProfileId(metas, st, 'Unknown glider')).toBe('a');
    st.last_profile_id = 'c';
    expect(selectProfileId(metas, st, 'Unknown glider')).toBe('c');
    expect(selectProfileId([], st, 'x')).toBeNull();
  });
});

describe('simple display preference', () => {
  it('defaults off, accepts only true, and preserves the independent transition and ballast choices', () => {
    expect(defaultSettings().ui.simple_flap).toBe(false);
    const d = defaultSettings();
    const saved = normalizeSettings({ ...d, ui: { ...d.ui, simple_flap: true, show_transitions: true, show_ballast: false } });
    expect(saved.ui).toMatchObject({ simple_flap: true, show_transitions: true, show_ballast: false });
    expect(normalizeSettings({ ...d, ui: { ...d.ui, simple_flap: 'true' } }).ui.simple_flap).toBe(false);
  });
});
