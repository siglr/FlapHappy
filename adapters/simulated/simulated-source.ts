import type { DataSource, SimSample } from '../../core/sim';
import { emptySample } from '../../core/sim';

export type Fault =
  | 'none'
  | 'index-missing'
  | 'index-out-of-range'
  | 'percent-only'
  | 'lvar-only'
  | 'unreadable'
  | 'stale';

export const FAULTS: Fault[] = [
  'none',
  'index-missing',
  'index-out-of-range',
  'percent-only',
  'lvar-only',
  'unreadable',
  'stale',
];

export interface SimControls {
  connected: boolean;
  inFlight: boolean;
  onGround: boolean;
  iasKt: number;
  totalWeightKg: number | null;
  /** Height above the ground, in feet. */
  aglFt: number;
  /** Ambient wind speed, in knots. */
  windKt: number;
  flapIndex: number;
  flapCount: number;
  fault: Fault;
  title: string;
}

export function defaultControls(): SimControls {
  return {
    connected: true,
    inFlight: true,
    onGround: false,
    iasKt: 80,
    totalWeightKg: null,
    aglFt: 600,
    windKt: 12,
    flapIndex: 0,
    flapCount: 6,
    fault: 'none',
    title: 'Simulated glider',
  };
}

/**
 * Drives the UI without a sim. Controls are mutated by the dev panel or scenarios; `tick` produces
 * the sample (the timer calls it at 10 Hz; tests call it directly with a fake clock).
 */
export class SimulatedSource implements DataSource {
  kind = 'simulated';
  controls: SimControls = defaultControls();
  lvarEnabled = false;
  private cb: ((s: SimSample) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private clock: () => number;
  private last = 0;

  constructor(clock: () => number = () => Date.now(), private publishControls?: (controls: SimControls) => void) {
    this.clock = clock;
  }

  start(cb: (s: SimSample) => void): void {
    this.cb = cb;
    this.last = this.clock();
    this.stop();
    this.timer = setInterval(() => this.tick(this.clock() - this.last), 100);
    this.cb = cb;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setLvarName(name: string | null): void {
    this.lvarEnabled = !!name;
  }

  /** Build the current sample without emitting (also used by tests). */
  snapshot(): SimSample {
    const c = this.controls;
    const s = emptySample(this.clock());
    s.connected = c.connected;
    if (!c.connected) return s;
    s.inFlight = c.inFlight;
    s.aircraftTitle = c.title;
    s.iasKt = c.iasKt;
    s.totalWeightKg = c.totalWeightKg;
    s.aglFt = isFinite(c.aglFt) ? c.aglFt : null;
    s.windKt = isFinite(c.windKt) ? c.windKt : null;
    s.onGround = c.onGround;
    s.flapCount = c.flapCount;

    const idx = c.flapIndex;
    const percent = c.flapCount > 1 ? idx / (c.flapCount - 1) : 0;

    switch (c.fault) {
      case 'none':
        s.flapIndex = idx;
        s.flapPercent = percent;
        if (this.lvarEnabled) s.lvar = idx;
        break;
      case 'index-missing':
        s.flapPercent = percent;
        break;
      case 'index-out-of-range':
        s.flapIndex = c.flapCount + 3;
        s.flapPercent = percent;
        break;
      case 'percent-only':
        s.flapPercent = percent;
        break;
      case 'lvar-only':
        if (this.lvarEnabled) s.lvar = idx;
        break;
      case 'unreadable':
      case 'stale':
        break;
    }
    return s;
  }

  tick(dtMs: number): void {
    this.last += dtMs;
    this.publishControls?.({ ...this.controls });
    const s = this.snapshot();
    if (this.controls.fault === 'stale' && this.controls.connected) return;
    if (this.cb) this.cb(s);
  }
}
