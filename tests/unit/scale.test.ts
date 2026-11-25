import { describe, expect, it } from 'vitest';
import { bucketIndex, columnEdges, effectiveBoundaries, effectiveSpeed, visualLowerBound, mapMarker, nativeWidth, smoothStep, tickLabels } from '../../core/scale';
import { makeProfile } from './helpers';

describe('ballast interpolation', () => {
  it('is linear between No Ballast and Max Ballast, clamped to 0..1', () => {
    const s = { no_ballast_kt: 60, max_ballast_kt: 80 };
    expect(effectiveSpeed(s, 0)).toBe(60);
    expect(effectiveSpeed(s, 1)).toBe(80);
    expect(effectiveSpeed(s, 0.25)).toBe(65);
    expect(effectiveSpeed(s, 2)).toBe(80);
    expect(effectiveSpeed({ no_ballast_kt: 70, max_ballast_kt: null }, 0.6)).toBe(70);
    expect(effectiveSpeed({ no_ballast_kt: null, max_ballast_kt: 70 }, 0.6)).toBeNull();
  });

  it('boundary vectors have N + 1 entries and stay ascending at every f', () => {
    for (const n of [0, 1, 2, 6, 12]) {
      const p = makeProfile(n);
      for (let f = 0; f <= 1.0001; f += 0.1) {
        const b = effectiveBoundaries(p, f)!;
        expect(b).toHaveLength(Math.max(n, 1) + 1);
        for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
      }
    }
  });

  it('returns null for incomplete or non-ascending profiles', () => {
    const p = makeProfile(3);
    p.transitions[1].no_ballast_kt = null;
    expect(effectiveBoundaries(p, 0)).toBeNull();
    const q = makeProfile(3);
    q.transitions[1].no_ballast_kt = 10;
    expect(effectiveBoundaries(q, 0)).toBeNull();
  });
});

describe('columns and marker', () => {
  it('edges sit at each boundary speed on a linear Vs..Vne scale, for any N', () => {
    for (const n of [1, 2, 6, 12]) {
      const b = effectiveBoundaries(makeProfile(n), 0.3)!;
      const e = columnEdges(b);
      expect(e).toHaveLength(n + 1);
      expect(e[0]).toBe(0);
      expect(e[n]).toBe(1);
      for (let i = 0; i <= n; i++) expect(e[i]).toBeCloseTo((b[i] - b[0]) / (b[n] - b[0]), 10);
    }
  });

  it('N = 0 gives one unsegmented column', () => {
    expect(columnEdges([40, 100])).toEqual([0, 1]);
  });

  it('column widths follow bucket widths, however narrow', () => {
    const e = columnEdges([40, 44, 100, 160]);
    const widths = [e[1] - e[0], e[2] - e[1], e[3] - e[2]];
    expect(widths[0]).toBeCloseTo(4 / 120, 10);
    expect(widths[1]).toBeCloseTo(56 / 120, 10);
    expect(widths[2]).toBeCloseTo(60 / 120, 10);
  });

  it('marker crosses each tick exactly when IAS crosses the transition', () => {
    for (const n of [1, 2, 6, 12]) {
      const b = effectiveBoundaries(makeProfile(n), 0.5)!;
      const e = columnEdges(b);
      for (let i = 1; i < n; i++) {
        expect(mapMarker(b[i], b, e).pos).toBeCloseTo(e[i], 10);
        expect(mapMarker(b[i] - 0.001, b, e).column).toBe(i - 1);
        expect(mapMarker(b[i], b, e).column).toBe(i);
      }
      expect(mapMarker(b[0], b, e).pos).toBeCloseTo(0, 10);
      expect(mapMarker(b[n], b, e).pos).toBeCloseTo(1, 10);
    }
  });

  it('moves at a constant rate across the whole bar and pins off-scale values to the ends', () => {
    const b = [40, 60, 100];
    const e = columnEdges(b);
    for (const ias of [40, 50, 60, 80, 100]) expect(mapMarker(ias, b, e).pos).toBeCloseTo((ias - 40) / 60, 10);
    expect(mapMarker(30, b, e)).toEqual({ pos: 0, region: 'below', column: -1 });
    expect(mapMarker(130, b, e)).toEqual({ pos: 1, region: 'above', column: -1 });
  });

  it('bucketIndex covers the whole range', () => {
    const b = [40, 60, 100];
    expect(bucketIndex(39, b)).toBe(-1);
    expect(bucketIndex(40, b)).toBe(0);
    expect(bucketIndex(59.9, b)).toBe(0);
    expect(bucketIndex(60, b)).toBe(1);
    expect(bucketIndex(100, b)).toBe(1);
    expect(bucketIndex(101, b)).toBe(-1);
  });

  it('ticks are rounded effective speeds and update with ballast', () => {
    const p = makeProfile(2);
    expect(tickLabels(effectiveBoundaries(p, 0)!)).toEqual(['40', '52', '82']);
    expect(tickLabels(effectiveBoundaries(p, 1)!)).toEqual(['50', '66', '82']);
    expect(tickLabels(effectiveBoundaries(p, 0.5)!)).toEqual(['45', '59', '82']);
  });
});

describe('sizing and smoothing', () => {
  it('native width is at least the minimum and grows with N at 64 px per column', () => {
    expect(nativeWidth(1)).toBe(560);
    expect(nativeWidth(12) - nativeWidth(11)).toBe(64);
    expect(nativeWidth(10)).toBeGreaterThanOrEqual(10 * 64);
  });

  it('smoothing converges and is disabled by tau 0', () => {
    expect(smoothStep(null, 80, 100, 300)).toBe(80);
    expect(smoothStep(60, 80, 100, 0)).toBe(80);
    let v: number | null = 60;
    for (let i = 0; i < 40; i++) v = smoothStep(v, 80, 100, 300);
    expect(v).toBeCloseTo(80, 2);
    const one = smoothStep(60, 80, 300, 300);
    expect(one).toBeCloseTo(60 + 20 * (1 - Math.exp(-1)), 8);
  });
});

it('uses a display-only median gap lower edge when stall IAS is absent',()=>{
 expect(visualLowerBound([55,63,73,86])).toBe(45);expect(visualLowerBound([40,55,65])).toBe(27.5);expect(visualLowerBound([40])).toBe(0);expect(visualLowerBound([5,100])).toBe(0);
 const p=makeProfile(4);p.vs_min={no_ballast_kt:null,max_ballast_kt:null};expect(effectiveBoundaries(p,0)).toEqual([40,52,64,76,p.vne]);
});
