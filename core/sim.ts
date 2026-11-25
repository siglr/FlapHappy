import type { Profile, ProfileMeta, Settings } from './types';

/** Always normalised: knots and fractions 0..1. */
export interface SimSample {
  connected: boolean;
  inFlight: boolean;
  iasKt: number | null;
  /** Actual loaded aircraft weight in kilograms. Null when unavailable. */
  totalWeightKg: number | null;
  /** Height above the ground, in feet. `PLANE ALT ABOVE GROUND`. */
  aglFt: number | null;
  /** Ambient wind speed, in knots. `AMBIENT WIND VELOCITY`. */
  windKt: number | null;
  onGround: boolean | null;
  flapIndex: number | null;
  flapCount: number | null;
  /** 0..1 */
  flapPercent: number | null;
  lvar: number | null;
  aircraftTitle: string | null;
  /** Local add-on identity (not a path); optional for older replay files. */
  aircraftContainer?: string | null;
  wingSpanM?: number | null;
  /** Timestamp in ms. */
  t: number;
}

export function emptySample(t = 0): SimSample {
  return {
    connected: false,
    inFlight: false,
    iasKt: null,
    totalWeightKg: null,
    aglFt: null,
    windKt: null,
    onGround: null,
    flapIndex: null,
    flapCount: null,
    flapPercent: null,
    lvar: null,
    aircraftTitle: null,
    aircraftContainer: null,
    wingSpanM: null,
    t,
  };
}

export interface DataSource {
  kind: string;
  start(cb: (s: SimSample) => void): void;
  stop(): void;
  /** Optional: profile-named L: variable to read alongside the standard set. */
  setLvarName?(name: string | null): void;
}

export interface SaveOptions {
  /** Informational only; the store recomputes it when listing. */
  incomplete?: boolean;
}

export interface ProfileStore {
  setDemoExamples?(on:boolean):void;
  list(): Promise<ProfileMeta[]>;
  load(id: string): Promise<Profile>;
  save(p: Profile, opts?: SaveOptions): Promise<void>;
  remove(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<void>;
}

export interface HostCapabilities {
  files: boolean;
  alwaysOnTop: boolean;
  textCopy: boolean;
  opacity: boolean;
  compact: boolean;
  openFolder: boolean;
}

export interface HostInfo {
  /** Data source requested at startup by the shell (`--source=`). */
  source: 'simconnect' | 'simulated' | 'replay';
  /** Show the dev control panel. */
  dev: boolean;
  /** Electron control window; telemetry and optional ribbon are hosted by the main process. */
  mainWindow?: boolean;
  panelAvailable?: boolean;
  version: string;
  platform: string;
}

export interface Host {
  capabilities: HostCapabilities;
  info(): Promise<HostInfo>;
  openJson(): Promise<string | null>;
  getPublishedWsgCatalog?(): Promise<import('./wsg-catalog').WsgCatalog>;
  getPublishedWsgVariant?(key:string):Promise<import('./wsg-reference').WsgAircraftMatch|null>;
  matchWsgAircraft?(container: string | null, span: number | null): Promise<import('./wsg-reference').WsgAircraftMatch | null>;
  saveJson(name: string, text: string): Promise<boolean>;
  setAlwaysOnTop(on: boolean): void;
  setOpacity(opacity: number): void;
  setCompact(on: boolean): void;
  openProfilesFolder(): void;
  quit(): void;
  /** Copy the in-sim toolbar panel into the MSFS Community folder. Returns a status message. */
  setExternalPanel?(on: boolean): Promise<boolean>;
  getExternalPanel?(): Promise<boolean>;
  panelStatus?(choice: import('./panel-install').PanelDestination): Promise<import('./panel-install').PanelInstallStatus>;
  browsePanelParent?(): Promise<string | null>;
  setPanelInstalled?(choice: import('./panel-install').PanelDestination, enabled: boolean): Promise<import('./panel-install').PanelInstallResult>;
  updatePanel?(choice: import('./panel-install').PanelDestination): Promise<import('./panel-install').PanelInstallResult>;
}
