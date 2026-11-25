import { contextBridge, ipcRenderer } from 'electron';

const INVOKE = new Set([
  'store:list', 'store:load', 'store:save', 'store:remove', 'store:getSettings', 'store:setSettings',
  'host:info', 'host:wsgCatalog', 'host:wsgAircraft', 'host:openJson', 'host:saveJson', 'host:setAlwaysOnTop', 'host:setOpacity', 'host:setCompact',
  'host:openProfilesFolder', 'host:quit', 'host:installPanel', 'source:start', 'source:stop', 'source:setLvar',
  'panel:state',
]);
const EVENTS = new Set(['sample', 'source:log', 'panel:ballast']);

contextBridge.exposeInMainWorld('flapHappyBridge', {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!INVOKE.has(channel)) return Promise.reject(new Error('Blocked channel: ' + channel));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel: string, cb: (payload: unknown) => void): void {
    if (!EVENTS.has(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
