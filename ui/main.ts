import { App } from './app';
import { SimulatedSource } from '../adapters/simulated/simulated-source';
import { MemoryProfileStore } from '../adapters/simulated/memory-store';
import { BrowserHost } from '../adapters/simulated/browser-host';
import { mountDevPanel } from '../adapters/simulated/devpanel';
import { BridgeDataSource, BridgeHost, BridgeProfileStore } from '../adapters/electron/bridge-adapters';
import { PRESETS } from '../profiles';

/**
 * Entry point shared by the Electron renderer and the plain-browser harness page.
 * Electron: preload exposes `flapHappyBridge`, so the real adapters are used.
 * Browser: simulated source, in-memory store, browser host. Query: ?seed=demo|none&dev=0|1
 * Only `demo` loads the built-in profiles. Any other seed, including `none`, stays empty.
 */
async function boot(): Promise<void> {
  const root = document.getElementById('app') as HTMLElement;
  const q = new URLSearchParams(window.location.search);
  const bridge = window.flapHappyBridge;
  const sim = new SimulatedSource(undefined, bridge ? controls => { void bridge.invoke('source:simulateControls', controls).catch(() => {}); } : undefined);
  let app: App;

  if (bridge) {
    const host = new BridgeHost(bridge);
    const info = await host.info();
    app = new App({
      root,
      store: new BridgeProfileStore(bridge),
      host,
      info,
      realSource: new BridgeDataSource(bridge, info.source),
      sim,
      compact: q.get('compact') === '1',
      mountDevPanel: info.dev ? mountDevPanel : undefined,
    });
  } else {
    const seed = q.get('seed') ?? 'demo';
    const profiles = seed === 'demo' ? PRESETS.map((p) => p.profile) : [];
    const host = new BrowserHost({ dev: q.get('dev') !== '0' });
    app = new App({
      root,
      store: new MemoryProfileStore(profiles),
      host,
      info: await host.info(),
      realSource: null,
      sim,
      compact: q.get('compact') === '1',
      mountDevPanel: q.get('dev') === '0' ? undefined : mountDevPanel,
    });
  }
  await app.init();
  (window as unknown as { __flapHappy: unknown }).__flapHappy = {
    app,
    sim,
    profileId: () => (app.profile ? app.profile.id : null),
  };
}

void boot();
