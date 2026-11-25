import { app, BrowserWindow, dialog, ipcMain, shell, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { parseCli } from './cli';
import { FileProfileStore } from '../adapters/electron/file-store';
import { SimConnectSource } from '../adapters/electron/simconnect-source';
import { ReplaySource, parseTraceJsonl } from '../adapters/simulated/replay-source';
import type { DataSource, HostInfo, SimSample } from '../core/sim';
import { emptySample } from '../core/sim';
import { COCKPIT_PORT } from '../core/cockpit';
import type { Profile, Settings, WindowBounds } from '../core/types';
import { PanelRuntime } from './panel-runtime';
import { SimulatedSource, type SimControls } from '../adapters/simulated/simulated-source';
import { startPanelServer } from './panel-server';
import { loadPublishedWsgCatalog, matchPublishedWsgAircraft } from '../adapters/electron/wsg-catalog-source';
import { installCockpitPanel } from './panel-install';

function windowIcon(): string | undefined {
  const packed = path.join(process.resourcesPath, 'icon.ico');
  const dev = path.join(__dirname, '..', 'build', 'icon.ico');
  if (fs.existsSync(packed)) return packed;
  if (fs.existsSync(dev)) return dev;
  return undefined;
}

const cli = parseCli(process.argv.slice(1));
const APP_NAME = 'Flap Happy';

// Profile library lives in %APPDATA%/FlapHappy (profiles/*.json + settings.json).
app.setName('FlapHappy');
app.setPath('userData', cli.userData ?? path.join(app.getPath('appData'), 'FlapHappy'));

let store: FileProfileStore;
let win: BrowserWindow | null = null;
let external: BrowserWindow | null = null;
let panelAvailable = false;
let source: DataSource | null = null;
let recorder: fs.WriteStream | null = null;
let boundsTimer: ReturnType<typeof setTimeout> | null = null;
let externalBoundsTimer: ReturnType<typeof setTimeout> | null = null;
let quitting = false;
let panelRuntime: PanelRuntime | null = null;
let initialized = false;
let openingWindow: Promise<void> | null = null;
let externalRequest: Promise<boolean> = Promise.resolve(false);

function info(): HostInfo {
  return { source: cli.source, dev: cli.dev, mainWindow: true, panelAvailable, version: app.getVersion(), platform: process.platform };
}

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function desiredSource(settings: Settings): HostInfo['source'] {
  return cli.source === 'simulated' || settings.ui.demo_mode ? 'simulated' : cli.source;
}

function startSource(kind: HostInfo['source']): void {
  if (source?.kind === kind) return;
  stopSource();
  panelRuntime?.setSourceKind(kind);
  send('sample', emptySample(Date.now()));
  if (kind === 'simulated') {
    source = new SimulatedSource();
  } else if (kind === 'replay') {
    if (!cli.trace) {
      send('source:log', 'Replay needs --trace=<file.jsonl>');
      return;
    }
    const samples = parseTraceJsonl(fs.readFileSync(cli.trace, 'utf8'));
    source = new ReplaySource(samples, { speed: cli.speed, loop: cli.loop });
  } else {
    source = new SimConnectSource({ protocol: cli.protocol, log: (m) => send('source:log', m) });
  }
  if (cli.record && !recorder) recorder = fs.createWriteStream(cli.record, { flags: 'a' });
  const active = source;
  active.start((s: SimSample) => {
    if (source !== active) return;
    if (recorder && s.connected) recorder.write(JSON.stringify(s) + '\n');
    if (panelRuntime) panelRuntime.sample(s, kind === 'replay' ? Date.now() : s.t);
    send('sample', s);
  });
  if (panelRuntime) source.setLvarName?.(panelRuntime.getState().profile?.current_flap.lvar_name ?? null);
}

function stopSource(): void {
  if (source) source.stop();
  source = null;
}

function windowBounds(saved: WindowBounds | null, width: number, height: number, minWidth: number, minHeight: number): Electron.Rectangle {
  const area = saved ? screen.getDisplayMatching(saved).workArea : screen.getPrimaryDisplay().workArea;
  const w = Math.min(area.width, Math.max(minWidth, saved?.width ?? width));
  const h = Math.min(area.height, Math.max(minHeight, saved?.height ?? height));
  return {
    width: w, height: h,
    x: Math.max(area.x, Math.min(area.x + area.width - w, saved?.x ?? Math.round(area.x + (area.width - w) / 2))),
    y: Math.max(area.y, Math.min(area.y + area.height - h, saved?.y ?? Math.round(area.y + (area.height - h) / 2))),
  };
}

function saveBoundsSoon(isExternal = false): void {
  const current = isExternal ? external : win;
  if (!current || current.isDestroyed() || current.isMinimized() || current.isMaximized()) return;
  const bounds = current.getBounds();
  const save = () => isExternal ? store.setWindowBounds(bounds) : store.setMainWindowBounds(bounds);
  if (isExternal) {
    if (externalBoundsTimer) clearTimeout(externalBoundsTimer);
    externalBoundsTimer = setTimeout(save, 400);
  } else {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(save, 400);
  }
}

async function createWindow(): Promise<void> {
  const settings = await store.getSettings();
  const w = new BrowserWindow({
    title: APP_NAME,
    ...windowBounds(settings.main_window, 760, cli.dev ? 760 : 560, 480, 360),
    minWidth: 480, minHeight: 360, frame: true,
    backgroundColor: '#0b0e13', icon: windowIcon(), autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  w.webContents.setWindowOpenHandler(({url,frameName}) => url==='about:blank'&&frameName==='flaphappy-profiles'
    ? {action:'allow',overrideBrowserWindowOptions:{title:APP_NAME+' - Profiles',parent:w,width:Math.min(760,screen.getDisplayMatching(w.getBounds()).workArea.width-20),height:Math.min(760,screen.getDisplayMatching(w.getBounds()).workArea.height-40),minWidth:460,minHeight:400,autoHideMenuBar:true,frame:true,show:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}}
    : {action:'deny'});
  w.setMenuBarVisibility(false);
  win = w;
  w.once('ready-to-show', () => { if (!w.isDestroyed()) w.show(); });
  w.on('resize', () => saveBoundsSoon());
  w.on('move', () => saveBoundsSoon());
  w.on('closed', () => {
    if (win === w) win = null;
    if (!quitting) app.quit();
  });
  w.on('page-title-updated', (e) => e.preventDefault());
  await w.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (!w.isDestroyed() && !w.isVisible()) w.show();
}

const EXTERNAL_URL = 'http://127.0.0.1:' + COCKPIT_PORT + '/panel.html';

function applyExternalAppearance(settings: Settings): void {
  if (!external || external.isDestroyed()) return;
  external.setAlwaysOnTop(settings.ui.always_on_top, settings.ui.always_on_top ? 'screen-saver' : 'normal');
  external.setOpacity(settings.ui.opacity);
}

function setExternalPanel(on: boolean): Promise<boolean> {
  const next = externalRequest.then(() => updateExternalPanel(on));
  externalRequest = next.catch(() => false);
  return next;
}

async function updateExternalPanel(on: boolean): Promise<boolean> {
  if (quitting || !panelRuntime) return false;
  if (!on || !panelAvailable) {
    if (external && !external.isDestroyed()) external.close();
    send('host:externalPanel', false);
    return false;
  }
  if (external && !external.isDestroyed()) {
    if (external.isMinimized()) external.restore();
    external.show();
    external.focus();
    return true;
  }
  const settings = await panelRuntime.settings();
  const w = new BrowserWindow({
    title: APP_NAME + ' - External panel',
    ...windowBounds(settings.window, 640, 270, 320, 240),
    minWidth: 320, minHeight: 240, frame: true, autoHideMenuBar: true,
    backgroundColor: '#0b0e13', icon: windowIcon(), show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.setMenuBarVisibility(false);
  external = w;
  applyExternalAppearance(settings);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (event, url) => { if (url !== EXTERNAL_URL) event.preventDefault(); });
  w.on('page-title-updated', (event) => event.preventDefault());
  w.on('resize', () => saveBoundsSoon(true));
  w.on('move', () => saveBoundsSoon(true));
  w.on('closed', () => {
    if (external === w) external = null;
    if (!quitting) {
      send('host:externalPanel', false);
    }
  });
  try {
    await w.loadURL(EXTERNAL_URL);
    if (w.isDestroyed() || external !== w || quitting) return false;
    w.setTitle(APP_NAME + ' - External panel');
    w.show();
    send('host:externalPanel', true);
    return true;
  } catch (e) {
    if (!w.isDestroyed()) w.close();
    console.error('Could not open external panel', e);
    return false;
  }
}

async function showDesktop(): Promise<void> {
  if (!initialized) return;
  if (openingWindow) { await openingWindow; return; }
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  if (!openingWindow) {
    openingWindow = createWindow().finally(() => { openingWindow = null; });
  }
  await openingWindow;
}

function registerIpc(): void {
  ipcMain.handle('store:list', () => store.list());
  ipcMain.handle('store:load', (_e, id: string) => store.load(id));
  ipcMain.handle('store:save', async (_e, p: Profile) => { await store.save(p); await panelRuntime?.refresh(); });
  ipcMain.handle('store:remove', async (_e, id: string) => { await store.remove(id); await panelRuntime?.refresh(); });
  ipcMain.handle('store:getSettings', () => panelRuntime ? panelRuntime.settings() : store.getSettings());
  ipcMain.handle('store:setSettings', async (_e, s: Settings) => {
    if (!panelRuntime || quitting) return;
    await panelRuntime.updateSettings(s);
    const current = await panelRuntime.settings();
    if (quitting) return;
    applyExternalAppearance(current);
    startSource(desiredSource(current));
  });

  ipcMain.handle('host:info', () => info());
  ipcMain.handle('host:wsgCatalog', () => loadPublishedWsgCatalog());
  ipcMain.handle('host:wsgAircraft', (_e, container: string | null, span: number | null) => matchPublishedWsgAircraft(container, span));
  ipcMain.handle('host:openJson', async () => {
    const r = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Open profile',
      defaultPath: store.profilesDir,
      properties: ['openFile'],
      filters: [{ name: 'Flap Happy profile', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return fs.readFileSync(r.filePaths[0], 'utf8');
  });
  ipcMain.handle('host:saveJson', async (_e, name: string, text: string) => {
    const fileName = path.basename(name);
    const r = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Save profile as',
      defaultPath: path.join(store.profilesDir, fileName),
      filters: [{ name: 'Flap Happy profile', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, text, 'utf8');
    return true;
  });
  ipcMain.handle('host:setAlwaysOnTop', (_e, on: boolean) => {
    if (external) external.setAlwaysOnTop(!!on, on ? 'screen-saver' : 'normal');
  });
  ipcMain.handle('host:setOpacity', (_e, o: number) => {
    if (external) external.setOpacity(Math.max(0.3, Math.min(1, o)));
  });
  ipcMain.handle('host:setCompact', () => { /* retained legacy bridge command; main stays framed */ });
  ipcMain.handle('host:getExternalPanel', () => !!external && !external.isDestroyed());
  ipcMain.handle('host:setExternalPanel', (event, on: boolean) => event.sender === win?.webContents && typeof on === 'boolean' ? setExternalPanel(on) : false);
  ipcMain.handle('host:openProfilesFolder', () => shell.openPath(store.profilesDir));
  ipcMain.handle('host:quit', () => app.quit());
  ipcMain.handle('host:installPanel', () => installCockpitPanel(path.join(__dirname, 'panel', 'flaphappy-ingamepanel')));
  ipcMain.handle('panel:getState',()=>panelRuntime?.getState()??null);
  ipcMain.handle('panel:setBallast', (_e, profileId: string, f: number) => quitting ? false : panelRuntime?.setBallast(f, profileId));

  ipcMain.handle('source:start', () => {
    const sample = panelRuntime?.getState().sample;
    if (sample) send('sample', sample);
  });
  ipcMain.handle('source:stop', () => { /* the session, not a window, owns telemetry */ });
  ipcMain.handle('source:setLvar', () => { /* selected profile is owned by the session */ });
  ipcMain.handle('source:simulateControls', (event, controls: SimControls) => {
    if (event.sender === win?.webContents && source instanceof SimulatedSource && controls && typeof controls === 'object') {
      source.controls = controls;
    }
  });

}

async function smokeAndCapture(): Promise<void> {
  if (!win) return;
  const w = win;
  await new Promise((r) => setTimeout(r, cli.smoke ? 2500 : 3500));
  if (cli.screenshot) {
    const img = await w.webContents.capturePage();
    fs.writeFileSync(cli.screenshot, img.toPNG());
  }
  if (cli.smoke) {
    const result = (await w.webContents.executeJavaScript(
      `({ title: document.title, controls: document.querySelectorAll('.fh-main-controls').length, profile: window.__flapHappy ? window.__flapHappy.profileId() : null })`,
    )) as { title: string; controls: number; profile: string | null };
    const metas = await store.list();
    console.log('SMOKE_RESULT ' + JSON.stringify({ ...result, library: metas.map((m) => m.id), userData: app.getPath('userData') }));
    app.exit(result.controls === 1 && result.title === APP_NAME ? 0 : 1);
    return;
  }
  app.quit();
}

const haveLock = app.requestSingleInstanceLock();
if (!haveLock || cli.quit) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const requested = parseCli(argv);
    if (requested.quit) { app.quit(); return; }
    if (quitting) return;
    void showDesktop().catch(e => console.error('Could not open Flap Happy', e));
  });
  app.whenReady().then(async () => {
    store = new FileProfileStore(app.getPath('userData'));
    await store.getSettings();
    registerIpc();
    panelRuntime = new PanelRuntime(store, (name) => source?.setLvarName?.(name), (profileId, f) => send('panel:ballast', { profileId, f }),matchPublishedWsgAircraft,state=>send('panel:active',state),desiredSource(await store.getSettings()));
    await panelRuntime.initialize();
    try {
      await startPanelServer({
        root: path.join(__dirname, 'renderer'),
        version: app.getVersion(),
        getState: () => panelRuntime?.getState() ?? null,
        onBallast: async (profileId,f) => {
          if (quitting) return false;
          return panelRuntime ? panelRuntime.setBallast(f,profileId) : false;
        },
      });
      panelAvailable = true;
    } catch (e) {
      console.error('Cockpit panel server did not start', e);
    }
    initialized = true;
    const settings = await panelRuntime.settings();
    startSource(desiredSource(settings));
    await showDesktop();
    if (settings.ui.external_panel_on_launch) await setExternalPanel(true);
    if (cli.smoke || cli.screenshot) void smokeAndCapture();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (panelRuntime && !quitting) {
      // Drain queued preference writes before the session exits.
      event.preventDefault();
      quitting = true;
      stopSource();
      void panelRuntime.flush().finally(() => app.quit());
      return;
    }
    quitting = true;
    stopSource();
    if (recorder) recorder.end();
  });
}
