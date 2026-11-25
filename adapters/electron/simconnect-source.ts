import { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } from 'node-simconnect';
import type { DataSource, SimSample } from '../../core/sim';
import { emptySample } from '../../core/sim';
import { aircraftContainer } from '../../core/wsg-reference';

const DEF_MAIN = 1;
const REQ_MAIN = 1;
const DEF_LVAR = 2;
const REQ_LVAR = 2;
const EV_PAUSE = 1;
const EV_SIM = 2;
const EV_AIRCRAFT = 3;

const RECONNECT_MS = 2000;
const WATCHDOG_MS = 250;
/** Sample every N sim frames (about 10 Hz at 30 fps, 20 Hz at 60 fps). */
const FRAME_INTERVAL = 3;

type ConnectionHandle = Awaited<ReturnType<typeof open>>['handle'];

export interface SimConnectOptions {
  protocol?: keyof typeof Protocol;
  appName?: string;
  log?: (msg: string) => void;
}

/**
 * Reads the sim over SimConnect (node-simconnect, pure TypeScript, no SimConnect.dll).
 * Retries every 2 s while MSFS is not running; emits `connected:false` samples while waiting.
 */
export class SimConnectSource implements DataSource {
  kind = 'simconnect';
  private cb: ((s: SimSample) => void) | null = null;
  private handle: ConnectionHandle | null = null;
  private connecting = false;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private last: SimSample = emptySample();
  private paused = false;
  private simRunning = true;
  private lvarName: string | null = null;
  private lastDataAt = 0;
  private stopped = true;
  private identityRequest = 100;
  private container: string | null = null;

  constructor(private opts: SimConnectOptions = {}) {}

  private log(m: string): void {
    if (this.opts.log) this.opts.log(m);
  }

  start(cb: (s: SimSample) => void): void {
    this.cb = cb;
    this.stopped = false;
    this.emitDisconnected();
    this.tryConnect();
    this.reconnectTimer = setInterval(() => {
      if (!this.handle) this.tryConnect();
    }, RECONNECT_MS);
    this.watchdog = setInterval(() => {
      if (!this.handle) this.emitDisconnected();
      else if (Date.now() - this.lastDataAt > 1000) this.emit(false); // never advance an old sample timestamp
    }, WATCHDOG_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.reconnectTimer = this.watchdog = null;
    this.dropConnection(false);
  }

  setLvarName(name: string | null): void {
    this.lvarName = name && name.trim() ? name.trim() : null;
    if (this.handle) this.registerLvar(this.handle);
  }

  private emitDisconnected(): void {
    this.last = { ...emptySample(Date.now()), aircraftTitle: this.last.aircraftTitle };
    this.emit(false);
  }

  private emit(refresh = true): void {
    if (!this.cb) return;
    const s = { ...this.last };
    if (refresh) s.t = Date.now();
    if (s.connected) s.inFlight = s.inFlight && !this.paused && this.simRunning;
    this.cb(s);
  }

  private dropConnection(announce: boolean): void {
    const h = this.handle;
    this.handle = null;
    if (h) {
      try {
        h.close();
      } catch {
        // Already closed.
      }
    }
    if (announce) this.emitDisconnected();
  }

  private async tryConnect(): Promise<void> {
    if (this.connecting || this.handle || this.stopped) return;
    this.connecting = true;
    try {
      const protocol = Protocol[this.opts.protocol ?? 'SunRise'];
      const { recvOpen, handle } = await open(this.opts.appName ?? 'Flap Happy', protocol);
      if (this.stopped) {
        handle.close();
        return;
      }
      this.handle = handle;
      this.log('Connected to ' + recvOpen.applicationName);
      this.paused = false;
      this.simRunning = true;
      this.setup(handle);
    } catch {
      // MSFS not running yet: stay in "Waiting for MSFS..." and retry.
    } finally {
      this.connecting = false;
    }
  }

  private setup(h: ConnectionHandle): void {
    const num = (name: string, unit: string) => h.addToDataDefinition(DEF_MAIN, name, unit, SimConnectDataType.FLOAT64);
    // Order matters: it is the read order below.
    num('AIRSPEED INDICATED', 'knots');
    num('FLAPS HANDLE INDEX', 'number');
    num('FLAPS NUM HANDLE POSITIONS', 'number');
    num('FLAPS HANDLE PERCENT', 'percent over 100');
    num('SIM ON GROUND', 'bool');
    num('TOTAL WEIGHT', 'kilograms');
    num('PLANE ALT ABOVE GROUND', 'feet');
    num('AMBIENT WIND VELOCITY', 'knots');
    num('WING SPAN', 'meters');
    h.addToDataDefinition(DEF_MAIN, 'TITLE', null, SimConnectDataType.STRING256);

    h.subscribeToSystemEvent(EV_PAUSE, 'Pause');
    h.subscribeToSystemEvent(EV_SIM, 'Sim');
    h.subscribeToSystemEvent(EV_AIRCRAFT, 'AircraftLoaded');
    this.container = null;
    const requestIdentity = () => { this.container = null; try { h.requestSystemState(++this.identityRequest, 'AircraftLoaded'); } catch { /* identity unavailable; do not guess */ } };
    h.on('systemState', state => { if (this.handle === h && state.requestID === this.identityRequest) this.container = aircraftContainer(state.dataString); });
    h.on('eventFilename', event => { if (this.handle === h && event.clientEventId === EV_AIRCRAFT) requestIdentity(); });

    h.requestDataOnSimObject(REQ_MAIN, DEF_MAIN, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SIM_FRAME, 0, 0, FRAME_INTERVAL);
    this.registerLvar(h);

    h.on('simObjectData', (d) => {
      if (this.handle !== h) return;
      if (d.requestID === REQ_MAIN) {
        const r = d.data;
        const ias = r.readFloat64();
        const idx = r.readFloat64();
        const count = r.readFloat64();
        const pct = r.readFloat64();
        const ground = r.readFloat64();
        const weight = r.readFloat64();
        const agl = r.readFloat64();
        const wind = r.readFloat64();
        const span = r.readFloat64();
        const title = r.readString256();
        if (title !== this.last.aircraftTitle) requestIdentity();
        this.lastDataAt = Date.now();
        this.last = {
          ...this.last,
          connected: true,
          inFlight: true,
          iasKt: ias,
          totalWeightKg: isFinite(weight) && weight > 0 ? weight : null,
          flapIndex: idx,
          flapCount: count,
          flapPercent: pct,
          onGround: ground > 0.5,
          aglFt: agl,
          windKt: wind,
          aircraftTitle: title,
          aircraftContainer: this.container,
          wingSpanM: isFinite(span) && span > 0 ? span : null,
          t: Date.now(),
        };
        this.emit(false);
      } else if (d.requestID === REQ_LVAR) {
        this.last = { ...this.last, lvar: d.data.readFloat64() };
      }
    });
    h.on('event', (e) => {
      if (e.clientEventId === EV_PAUSE) this.paused = e.data === 1;
      else if (e.clientEventId === EV_SIM) this.simRunning = e.data === 1;
      this.emit(false);
    });
    h.on('exception', (ex) => this.log('SimConnect exception: ' + JSON.stringify(ex)));
    h.on('quit', () => {
      this.log('Simulator quit');
      this.dropConnection(true);
    });
    h.on('close', () => {
      this.log('SimConnect connection closed');
      if (this.handle === h) this.dropConnection(true);
    });
    h.on('error', (err) => this.log('SimConnect error: ' + String(err)));
    this.last = { ...emptySample(Date.now()), connected: true, inFlight: false };
  }

  private registerLvar(h: ConnectionHandle): void {
    try {
      h.clearDataDefinition(DEF_LVAR);
    } catch {
      // Nothing registered yet.
    }
    if (!this.lvarName) {
      this.last = { ...this.last, lvar: null };
      return;
    }
    const name = this.lvarName.toUpperCase().startsWith('L:') ? this.lvarName : 'L:' + this.lvarName;
    h.addToDataDefinition(DEF_LVAR, name, 'number', SimConnectDataType.FLOAT64);
    h.requestDataOnSimObject(REQ_LVAR, DEF_LVAR, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SIM_FRAME, 0, 0, FRAME_INTERVAL);
  }
}
