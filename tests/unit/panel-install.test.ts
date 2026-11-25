import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installCockpitPanel, panelInstallStatus, removeCockpitPanel } from '../../app-electron/panel-install';
import type { PanelDestination } from '../../core/panel-install';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const def:PanelDestination={kind:'community',customParent:null};
const stopped=()=>false;
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'fh-installer-test-'));roots.push(root);
 const community=join(root,'Community2024'),legacy=join(root,'Community'),library=join(root,'My add-ons');
 for(const p of [community,legacy,library])mkdirSync(p);
 const bundle=join(root,'bundle');cpSync(resolve('panel/flaphappy-ingamepanel'),bundle,{recursive:true});
 const version=(v:string)=>{const path=join(bundle,'manifest.json'),m=JSON.parse(readFileSync(path,'utf8'));m.package_version=v;writeFileSync(path,JSON.stringify(m));};
 version('1.0.0');
 const choice:PanelDestination={kind:'custom',customParent:library};
 const status=(c=def)=>panelInstallStatus(bundle,c,community);
 const install=(c=def,rename=renameSync)=>installCockpitPanel(bundle,c,community,rename,stopped);
 const remove=(c=def)=>removeCockpitPanel(bundle,c,community,renameSync,stopped);
 return {root,bundle,community,legacy,library,choice,version,status,install,remove};
}
describe('Flap Happy managed panel installation',()=>{
 it('default, normalize actual Community, status, newer update, no downgrade, remove, no staging left',()=>{
  const f=fixture(),target=join(f.community,'flaphappy-ingamepanel');
  expect(f.status({kind:'custom',customParent:f.community}).destination.kind).toBe('community');
  expect(f.status().action).toBe('Install');
  expect(f.install().ok).toBe(true);expect(f.status().state).toBe('up-to-date');
  expect(existsSync(join(target,'InGamePanels','FlapHappy.spb'))).toBe(true);
  f.version('1.0.2');expect(f.status().action).toBe('Update');expect(f.install().ok).toBe(true);
  f.version('1.0.0');expect(f.status().state).toBe('newer-installed');expect(f.status().action).toBeNull();
  expect(f.remove().ok).toBe(true);expect(f.status().state).toBe('not-installed');
  expect(readdirSync(f.root).some(n=>n.startsWith('.flaphappy-stage-'))).toBe(false);
  expect(readdirSync(f.community)).toEqual([]);
 });
 it('custom location with Addons Linker junction, alternate link name, update but never remove linked source',()=>{
  const f=fixture(),target=join(f.library,'flaphappy-ingamepanel'),link=join(f.community,'Custom add-on link');
  expect(f.install(f.choice).ok).toBe(true);expect(f.status(f.choice).linked).toBe(false);
  symlinkSync(target,link,'junction');
  expect(f.status(f.choice).linked).toBe(true);expect(f.status().state).toBe('conflict');
  f.version('1.0.2');expect(f.install(f.choice).ok).toBe(true);
  expect(f.status(f.choice).linked).toBe(true);expect(f.remove(f.choice).ok).toBe(false);
  unlinkSync(link);expect(f.remove(f.choice).ok).toBe(true);
 });
 it('refuses duplicate/default conflict, custom subfolder and corrupt bundle with existing package intact',()=>{
  const f=fixture(),target=join(f.community,'flaphappy-ingamepanel');
  expect(f.install().ok).toBe(true);expect(f.status(f.choice).state).toBe('conflict');
  const nested=join(f.community,'nested');mkdirSync(nested);
  expect(f.status({kind:'custom',customParent:nested}).state).toBe('conflict');
  cpSync(target,join(f.legacy,'flaphappy-ingamepanel'),{recursive:true});
  expect(f.status().state).toBe('conflict');
  rmSync(join(f.legacy,'flaphappy-ingamepanel'),{recursive:true});
  unlinkSync(join(f.bundle,'InGamePanels','FlapHappy.spb'));expect(f.install().ok).toBe(false);
  expect(existsSync(join(target,'InGamePanels','FlapHappy.spb'))).toBe(true);
 });
 it('rollback on swap failure; running simulator prevents mutation; unknown file survives',()=>{
  const f=fixture(),target=join(f.community,'flaphappy-ingamepanel');
  expect(f.install().ok).toBe(true);f.version('1.0.2');
  const result=f.install(def,(a,b)=>{if(String(a).endsWith('new-package'))throw Error('injected failure');renameSync(a,b);});
  expect(result.ok).toBe(false);expect(f.status().installedVersion).toBe('1.0.0');
  expect(installCockpitPanel(f.bundle,def,f.community,renameSync,()=>true).ok).toBe(false);
  expect(f.status().installedVersion).toBe('1.0.0');
  writeFileSync(join(target,'unrelated.txt'),'preserve');
  expect(f.status().state).toBe('cannot-verify');expect(f.install().ok).toBe(false);expect(f.remove().ok).toBe(false);
  expect(readFileSync(join(target,'unrelated.txt'),'utf8')).toBe('preserve');
  expect(readdirSync(f.root).some(n=>n.startsWith('.flaphappy-stage-'))).toBe(false);
 });
});
