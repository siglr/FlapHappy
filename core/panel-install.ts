export interface PanelDestination {
  kind:'community'|'custom';
  customParent:string|null;
}
export type PanelInstallState='not-installed'|'up-to-date'|'update-available'|'newer-installed'|'unavailable'|'conflict'|'cannot-verify';
export interface PanelInstallStatus {
  state:PanelInstallState;
  destination:PanelDestination;
  installed:boolean;
  canRemove:boolean;
  community:string|null;
  target:string|null;
  bundledVersion:string|null;
  installedVersion:string|null;
  linked:boolean|null;
  action:'Install'|'Update'|null;
  message:string;
}
export interface PanelInstallResult {ok:boolean;message:string;status:PanelInstallStatus;}
export function normalizePanelDestination(raw:unknown):PanelDestination {
  const r=raw&&typeof raw==='object'?raw as Partial<PanelDestination>:{};
  return {kind:r.kind==='custom'?'custom':'community',customParent:typeof r.customParent==='string'&&r.customParent.trim()?r.customParent:null};
}
