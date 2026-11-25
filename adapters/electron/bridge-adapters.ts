import type { DataSource, Host, HostInfo, ProfileStore, SimSample } from '../../core/sim';
import type { Profile, ProfileMeta, Settings } from '../../core/types';

export interface FlapHappyBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, cb: (payload: unknown) => void): void;
}

declare global {
  interface Window {
    flapHappyBridge?: FlapHappyBridge;
  }
}

/** Renderer side of the Electron IPC bridge: the UI only ever sees these three interfaces. */
export class BridgeDataSource implements DataSource {
  kind = 'simconnect';
  private cb: ((s: SimSample) => void) | null = null;
  private subscribed = false;
  constructor(private bridge: FlapHappyBridge, kind = 'simconnect') {
    this.kind = kind;
  }
  start(cb: (s: SimSample) => void): void {
    this.cb = cb;
    if (!this.subscribed) {
      this.subscribed = true;
      this.bridge.on('sample', (p) => {
        if (this.cb) this.cb(p as SimSample);
      });
    }
    void this.bridge.invoke('source:start');
  }
  stop(): void {
    this.cb = null;
    void this.bridge.invoke('source:stop');
  }
  setLvarName(name: string | null): void {
    void this.bridge.invoke('source:setLvar', name);
  }
}

export class BridgeProfileStore implements ProfileStore {
  constructor(private bridge: FlapHappyBridge) {}
  list(): Promise<ProfileMeta[]> {
    return this.bridge.invoke('store:list') as Promise<ProfileMeta[]>;
  }
  load(id: string): Promise<Profile> {
    return this.bridge.invoke('store:load', id) as Promise<Profile>;
  }
  async save(p: Profile): Promise<void> {
    await this.bridge.invoke('store:save', p);
  }
  async remove(id: string): Promise<void> {
    await this.bridge.invoke('store:remove', id);
  }
  getSettings(): Promise<Settings> {
    return this.bridge.invoke('store:getSettings') as Promise<Settings>;
  }
  async setSettings(s: Settings): Promise<void> {
    await this.bridge.invoke('store:setSettings', s);
  }
}

export class BridgeHost implements Host {
  capabilities = { files: true, alwaysOnTop: true, textCopy: true, opacity: true, compact: true, openFolder: true };
  constructor(private bridge: FlapHappyBridge) {}
  info(): Promise<HostInfo> {
    return this.bridge.invoke('host:info') as Promise<HostInfo>;
  }
  getPublishedWsgCatalog(): Promise<import('../../core/wsg-catalog').WsgCatalog> {
    return this.bridge.invoke('host:wsgCatalog') as Promise<import('../../core/wsg-catalog').WsgCatalog>;
  }
  openJson(): Promise<string | null> {
    return this.bridge.invoke('host:openJson') as Promise<string | null>;
  }
  saveJson(name: string, text: string): Promise<boolean> {
    return this.bridge.invoke('host:saveJson', name, text) as Promise<boolean>;
  }
  setAlwaysOnTop(on: boolean): void {
    void this.bridge.invoke('host:setAlwaysOnTop', on);
  }
  setOpacity(o: number): void {
    void this.bridge.invoke('host:setOpacity', o);
  }
  setCompact(on: boolean): void {
    void this.bridge.invoke('host:setCompact', on);
  }
  openProfilesFolder(): void {
    void this.bridge.invoke('host:openProfilesFolder');
  }
  quit(): void {
    void this.bridge.invoke('host:quit');
  }
  installCockpitPanel(): Promise<string> {
    return this.bridge.invoke('host:installPanel') as Promise<string>;
  }
}
