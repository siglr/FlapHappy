import { describe, expect, it } from 'vitest';
import {
  addRow, createBlankProfile, deleteRow, exportProfileJson, insertRowAfter, insertRowBefore, moveLabel,
  normalizeProfile, parseProfileJson, prefillMaxBallast, sanitizeId,
  uniqueId, transitionName, profileMatchesTitle,
} from '../../core/profile';
import { PRESETS } from '../../profiles';
import { knotsToMs } from '../../core/units';
import { makeProfile } from './helpers';
import { PROFILE_SCHEMA } from '../../core/types';

const tcount = (n: number) => Math.max(n - 1, 0);

describe('profile import / export', () => {
  it('ships the three built-in profiles and they normalise cleanly', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['as33-18m', 'as33-15m', 'js3']);
    const as33 = PRESETS[0].profile;
    expect(as33.flaps.map((f) => f.label)).toEqual(['5', 'N', '4', '3', '2', '1']);
    expect(as33.flaps.map((f) => f.handle_index)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(as33.transitions).toHaveLength(5);
    expect(as33.vne).not.toBeNull();
    for (const preset of PRESETS) {
      expect(preset.profile.transitions).toHaveLength(Math.max(preset.profile.flaps.length - 1, 0));
    }
  });

  it('strips _help style keys and round-trips exactly', () => {
    const text = exportProfileJson(PRESETS[0].profile);
    expect(text).not.toContain('_help');
    expect(text).not.toContain('no_ballast_kt');
    expect(text).not.toContain('display_name');
    const raw = JSON.parse(text);
    expect(raw.units).toBe('ms');
    expect(raw.vne).toBeUndefined();
    expect(raw.vne_ms).toBe(knotsToMs(PRESETS[0].profile.vne as number));
    const again = parseProfileJson(text);
    expect(again.errors).toEqual([]);
    expect(again.profile).toEqual(PRESETS[0].profile);
  });

  it('ignores a ballast VNE object and knot speed keys', () => {
    const raw = JSON.parse(exportProfileJson(makeProfile(2)));
    raw.vne = { no_ballast_ms: raw.vne_ms, max_ballast_ms: 99 };
    delete raw.vne_ms;
    raw.vs_min = { no_ballast_kt: 40, max_ballast_kt: 50 };
    const parsed = normalizeProfile(raw);
    expect(parsed.profile?.vne).toBeNull();
    expect(parsed.profile?.vs_min).toEqual({ no_ballast_kt: null, max_ballast_kt: null });
  });

  it('rejects transitions of the wrong length and bad JSON', () => {
    const raw = JSON.parse(exportProfileJson(makeProfile(3)));
    raw.transitions.pop();
    expect(normalizeProfile(raw).profile).toBeNull();
    expect(normalizeProfile(raw).errors[0]).toMatch(/transitions/);
    expect(parseProfileJson('{nope').errors[0]).toMatch(/Not valid JSON/);
    expect(normalizeProfile([]).errors).toHaveLength(1);
    expect(normalizeProfile({ schema: 'other/9', flaps: [], transitions: [] }).errors[0]).toMatch(/Unsupported/);
    const renamed = JSON.parse(exportProfileJson(makeProfile(2)));
    renamed.schema = 'flapsugest.profile/3';
    expect(normalizeProfile(renamed).errors[0]).toMatch(/Unsupported/);
    const knots = JSON.parse(exportProfileJson(makeProfile(1)));
    knots.units = 'kt';
    expect(normalizeProfile(knots).errors[0]).toMatch(/units "ms"/);
    const angle = JSON.parse(exportProfileJson(makeProfile(1)));
    angle.current_flap.source = 'angle';
    expect(normalizeProfile(angle).errors[0]).toMatch(/current_flap.source/);
  });

  it('fills defaults for a minimal file', () => {
    const r = normalizeProfile({ schema: PROFILE_SCHEMA, units: 'ms', id: 'My Glider!', flaps: [], transitions: [] });
    expect(r.profile?.id).toBe('my-glider');
    expect(r.profile?.ballast.default_fraction).toBe(1);
    expect(r.profile?.ballast).not.toHaveProperty('restore');
  });

  it('sanitises and de-duplicates ids', () => {
    expect(sanitizeId('../Evil Name')).toBe('evil-name');
    expect(uniqueId('a', ['a', 'a-2'])).toBe('a-3');
    expect(uniqueId('!!!', [])).toBe('profile');
  });

  it('matches titles case-insensitively', () => {
    expect(profileMatchesTitle(['as 33'], 'Got Friends AS 33 Me')).toBe(true);
    expect(profileMatchesTitle([], 'x')).toBe(false);
    expect(profileMatchesTitle(['x'], null)).toBe(false);
  });
});

describe('row editing keeps N-1 transitions', () => {
  it('adding the first row creates no transition, then one each', () => {
    let p = createBlankProfile();
    for (let n = 1; n <= 12; n++) {
      p = addRow(p).profile;
      expect(p.flaps).toHaveLength(n);
      expect(p.transitions).toHaveLength(tcount(n));
    }
  });

  it('append prefills the midpoint of the last boundary and Vne (both ends)', () => {
    const p = makeProfile(2); // vs 40/50, T1 52/66, vne 82
    const r = addRow(p);
    expect(r.prefilled).toBe(1);
    expect(r.profile.transitions[1]).toEqual({ no_ballast_kt: 67, max_ballast_kt: 74 });
    expect(r.profile.transitions[0]).toEqual(p.transitions[0]);
  });

  it('one row: new transition is the midpoint of Vs and Vne', () => {
    const p = makeProfile(1); // vs 40/50, vne 66
    const r = addRow(p);
    expect(r.profile.transitions).toEqual([{ no_ballast_kt: 53, max_ballast_kt: 58 }]);
  });

  it('insert after row i keeps the old transition below and splits the next bucket', () => {
    const p = makeProfile(4); // T = 52,64,76 / 66,82,98
    const r = insertRowAfter(p, 1);
    expect(r.profile.flaps).toHaveLength(5);
    expect(r.profile.transitions).toHaveLength(4);
    expect(r.profile.transitions[1]).toEqual(p.transitions[1]);
    expect(r.prefilled).toBe(2);
    expect(r.profile.transitions[2]).toEqual({ no_ballast_kt: 70, max_ballast_kt: 90 });
    expect(r.profile.transitions[3]).toEqual(p.transitions[2]);
  });

  it('insert before the first row uses the midpoint of Vs and T1', () => {
    const p = makeProfile(3);
    const r = insertRowBefore(p, 0);
    expect(r.prefilled).toBe(0);
    expect(r.profile.transitions[0]).toEqual({ no_ballast_kt: 46, max_ballast_kt: 58 });
    expect(r.profile.transitions.slice(1)).toEqual(p.transitions);
  });

  it('insert before the first row of a 1-row profile uses Vs and Vne', () => {
    const r = insertRowBefore(makeProfile(1), 0);
    expect(r.profile.transitions).toHaveLength(1);
  });

  it('missing neighbours give a blank transition', () => {
    const p = makeProfile(2);
    p.transitions[0].no_ballast_kt = null;
    const r = insertRowAfter(p, 0);
    expect(r.profile.transitions[1].no_ballast_kt).toBeNull();
  });

  it('add and delete leave the other sim indexes alone; a new row starts blank', () => {
    const up = makeProfile(3);
    const added = addRow(deleteRow(up, 1)).profile;
    expect(added.flaps.map((f) => f.handle_index)).toEqual([0, 2, null]);
    expect(added.flaps.map((f) => f.label)).toEqual(['1', '3', '4']);

    const down = makeProfile(4);
    down.flaps.forEach((f, i) => (f.handle_index = 3 - i));
    const removed = deleteRow(down, 1);
    expect(removed.flaps.map((f) => f.handle_index)).toEqual([3, 1, 0]);
    expect(removed.flaps.map((f) => f.label)).toEqual(['1', '3', '4']);
    const extended = addRow(removed).profile;
    expect(extended.flaps.map((f) => f.handle_index)).toEqual([3, 1, 0, null]);
  });

  it('a new row on a downward list is blank and keeps the old indexes', () => {
    const p = makeProfile(6);
    p.flaps.forEach((f, i) => (f.handle_index = 5 - i));
    const added = addRow(p).profile;
    expect(added.flaps.map((f) => f.handle_index)).toEqual([null, 5, 4, 3, 2, 1, 0]);
    expect(added.flaps.slice(1).map((f) => f.label)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('delete removes the slower-side transition (or the first one for row 0)', () => {
    const p = makeProfile(4);
    expect(deleteRow(p, 2).transitions).toEqual([p.transitions[0], p.transitions[2]]);
    expect(deleteRow(p, 0).transitions).toEqual([p.transitions[1], p.transitions[2]]);
    expect(deleteRow(p, 3).transitions).toEqual([p.transitions[0], p.transitions[1]]);
    expect(deleteRow(makeProfile(1), 0).transitions).toEqual([]);
    expect(deleteRow(p, 9)).toBe(p);
  });

  it('every N from 0 to 12 stays consistent through insert and delete sequences', () => {
    let p = createBlankProfile();
    for (let step = 0; step < 40; step++) {
      const n = p.flaps.length;
      const grow = step % 3 !== 2 && n < 12;
      if (grow) p = (step % 2 ? insertRowBefore(p, Math.floor(n / 2)) : insertRowAfter(p, Math.max(0, n - 1))).profile;
      else if (n > 0) p = deleteRow(p, (step * 7) % n);
      expect(p.transitions).toHaveLength(tcount(p.flaps.length));
    }
  });

  it('moving a label shifts the others; the sim indexes and transitions stay put', () => {
    const p = makeProfile(3);
    const q = moveLabel(p, 0, 2);
    expect(q.flaps.map((f) => f.label)).toEqual(['2', '3', '1']);
    expect(q.flaps.map((f) => f.handle_index)).toEqual([0, 1, 2]);
    expect(q.transitions).toEqual(p.transitions);
    expect(moveLabel(p, 2, 0).flaps.map((f) => f.label)).toEqual(['3', '1', '2']);
    expect(moveLabel(p, 1, 1)).toBe(p);
    expect(moveLabel(p, 0, -1)).toBe(p);
  });

  it('names transitions', () => {
    const p = makeProfile(3);
    expect(transitionName(p, 0)).toBe('1 -> 2');
  });

  it('prefills max ballast with sqrt of the mass ratio', () => {
    const p = makeProfile(2);
    p.vs_min.max_ballast_kt = null;
    const q = prefillMaxBallast(p, 400, 600);
    expect(q.vs_min.max_ballast_kt).toBeCloseTo(40 * Math.sqrt(1.5), 1);
    expect(q.transitions[0].max_ballast_kt).toBeCloseTo(52 * Math.sqrt(1.5), 1);
  });
});

it('preserves stored SI precision in both editor units without rounding to tenths of a knot internally',()=>{
 const original=JSON.parse(exportProfileJson(makeProfile(3)));original.transitions[0].no_ballast_ms=26.27;
 const parsed=normalizeProfile(original).profile!;expect(JSON.parse(exportProfileJson(parsed)).transitions[0].no_ballast_ms).toBe(26.27);
});
