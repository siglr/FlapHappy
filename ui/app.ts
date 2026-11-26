import type { DisplayPreferences,DisplayUnitOverrides,SpeedUnit,WeightUnit,WindUnit } from '../core/units';
import type { CockpitState } from '../core/cockpit';
import type { WsgCatalog } from '../core/wsg-catalog';
import type { WsgAircraftMatch } from '../core/wsg-reference';
import { wsgFlightProfile,wsgBoundaries } from '../core/wsg-flight';
import type { DataSource, Host, HostInfo, ProfileStore, SimSample } from '../core/sim';
import type { Profile, ProfileMeta, Settings, ValidationResult } from '../core/types';
import { validateProfile } from '../core/validate';
import { CurrentFlapResolver, type CurrentFlap } from '../core/flapmap';
import { buildDisplayModel, deriveLink, type DisplayModel } from '../core/display-model';
import { canSaveWeightMode, interpolationFraction, liveWeight, profileForWeightMode, usesManualBallast, validWeightAnchors, weightModeForProfile, type WeightMode } from '../core/weight';
import { initialBallast, type BallastState } from '../core/ballast';
import { resolveProfileChoice, selectProfileId } from '../core/select';
import { effectiveBoundaries, smoothStep } from '../core/scale';
import { clamp01, cloneProfile, exportProfileJson, parseProfileJson, profileLabel, sanitizeId } from '../core/profile';
import { defaultSettings,forgetLocalProfile } from '../core/settings';
import { SimulatedSource } from '../adapters/simulated/simulated-source';
import { clear, h, setText, toggleClass } from './dom';
import { StripView } from './strip';
import { WeightControl } from './slider';
import { SettingsView, type ImportDraft, type SettingsArea } from './settings';

export interface AppDeps {
  root: HTMLElement;
  store: ProfileStore;
  host: Host;
  info: HostInfo;
  /** Bridge-backed source (Electron); null in the plain browser harness. */
  realSource: DataSource | null;
  sim: SimulatedSource;
  compact: boolean;
  /** Mounts the dev control panel (simulated mode only). */
  mountDevPanel?: (container: HTMLElement, app: App) => void;
}

const SAVE_DEBOUNCE_MS = 500;

export class App {
  settings: Settings = defaultSettings();
  launchUnits:DisplayUnitOverrides={};
  get displayUnits():DisplayPreferences { const {units,height,weight_unit,wind_unit}=this.settings;return {units,height,weight_unit,wind_unit,...this.launchUnits}; }
  metas: ProfileMeta[] = [];
  profile: Profile | null = null;
  validation: ValidationResult | null = null;
  ballast: BallastState = { f: 0, unconfirmed: true, restored: false };
  lastSample: SimSample | null = null;
  lastRx = 0;
  flap: CurrentFlap = { status: 'unknown', rowIndex: null, label: null, handleIndex: null, via: null };
  usingSim = false;
  lastModel: DisplayModel | null = null;
  onModel: (() => void) | null = null;

  private resolver = new CurrentFlapResolver();
  private smoothIas: number | null = null;
  private smoothAgl: number | null = null;
  private smoothAt = 0;
  private strip?: StripView;
  private slider?: WeightControl;
  private externalBtn: HTMLButtonElement | null = null;
  private launchCheck: HTMLInputElement | null = null;
  private externalOpen = false;
  private panelUpdatePending=false;
  private mainConnection:HTMLElement|null=null;
  private mainAircraft:HTMLElement|null=null;
  private mainActiveProfile:HTMLElement|null=null;
  private mainProfileSource:HTMLElement|null=null;
  private mainExternalState:HTMLElement|null=null;
  private displayView!: HTMLElement;
  private statusEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private pinBtn: HTMLElement | null = null;
  private settingsView: SettingsView | null = null;
  private settingsHost!: HTMLElement;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  /** Profile edits that have not been written yet. The display keeps the last saved profile until Save. */
  unsaved: Profile | null = null;
  /** In-memory editor intent; only the anchors are persisted in a profile file. */
  unsavedWeightMode: WeightMode = 'manual';
  private lastTitle: string | null = null;
  private liveBindingKey: string | null = null;
  private liveSelectionGeneration = 0;
  private noProfileMessage = '';
  detectedWsgVariant: string | null = null;
  private activeWsgMatch:WsgAircraftMatch|null=null;
  private profileEditorWindow: Window|null=null;
  private profileControls: HTMLElement|null=null;
  private profileControlsSignature='';
  private mainWsgCatalog:WsgCatalog|null=null;
  private mainWsgStatus='';
  private catalogGeneration=0;
  private catalogLoading:Promise<WsgCatalog>|null=null;
  activeProfileSource: 'manual'|'assigned'|'local'|'fallback'|'wsg'|'none' = 'none';
  private unsavedBindingKey: string | null = null;
  get currentAircraftBindingKey(): string | null { return this.liveBindingKey; }
  get draftAircraftBindingKey(): string | null { return this.unsavedBindingKey; }
  private manualPick = false;
  private pendingImport: ImportDraft | null = null;

  constructor(private deps: AppDeps) {}

  get host(): Host {
    return this.deps.host;
  }
  get store(): ProfileStore {
    return this.deps.store;
  }
  get sim(): SimulatedSource {
    return this.deps.sim;
  }
  get info(): HostInfo {
    return this.deps.info;
  }
  get compact(): boolean {
    return this.deps.compact;
  }

  async init(): Promise<void> {
    this.settings = await this.deps.store.getSettings();
    this.metas = await this.deps.store.list();
    this.buildUi();
    void this.refreshPanelUpdateIndicator();
    if(this.deps.info.mainWindow&&this.host.getPublishedWsgCatalog)void this.loadAvailableWsgProfiles().catch(()=>{});
    this.installDrop();

    this.usingSim = this.deps.info.source === 'simulated' || this.settings.ui.demo_mode || !this.deps.realSource;
    const id = this.deps.info.mainWindow||this.strictLiveSelection() ? null : selectProfileId(this.metas, this.settings, null);
    if (id) await this.activate(id, false);
    else this.renderAll();
    this.startSource();
    this.applyHostSettings();
    const bridge = window.flapHappyBridge;
    if (bridge) {
      bridge.on('panel:ballast', (f) => {
        if (typeof f === 'number' && isFinite(f)) this.setManualBallast(f,true,true);
        else if (this.deps.info.mainWindow && f && typeof f === 'object') {
          const update = f as { profileId?: string; f?: number };
          if (typeof update.profileId === 'string' && typeof update.f === 'number' && isFinite(update.f)) {
            this.settings.ballast_by_profile[update.profileId] = update.f;
            if (this.profile?.id === update.profileId) this.setManualBallast(update.f,true,true);
          }
        }
      });
    }
    if (this.deps.info.mainWindow && bridge) {
      bridge.on('panel:active',value=>this.syncRuntimeState(value as CockpitState));
      await this.readRuntimeState();
      bridge.on('host:externalPanel', value => { this.externalOpen = value === true; this.paintExternal(); });
      this.externalOpen = await this.host.getExternalPanel?.() ?? false;
      this.paintExternal();
    }
    setInterval(() => this.renderAll(), 500);
    if (!this.profile && !this.deps.info.mainWindow&&!this.strictLiveSelection()) this.openSettings();
  }

  setPanelUpdateIndicator(status: import('../core/panel-install').PanelInstallStatus): void {
    const pending=status.installed&&status.action==='Update';
    this.panelUpdatePending=pending;
    for(const button of this.deps.root.querySelectorAll<HTMLElement>('.fh-cog,.fh-main-settings')){
      button.classList.toggle('fh-panel-update',pending);
      button.title=pending?'Settings — panel update available':'Settings';
    }
  }
  async refreshPanelUpdateIndicator(): Promise<void> {
    try{const status=await this.host.panelStatus?.(this.settings.panel_destination);if(status)this.setPanelUpdateIndicator(status);}catch{/* no verified update */}
  }

  // ---------------------------------------------------------------- UI shell

  private buildUi(): void {
    const root = this.deps.root;
    clear(root);
    root.className = 'fh-root' + (this.deps.compact ? ' fh-compact' : '');

    if (!this.deps.info.mainWindow) {
      this.slider = new WeightControl((f)=>this.setManualBallast(f,true));
      this.strip = new StripView({ weightRow: this.slider.el });
    }
    this.titleEl = h('div', { class: 'fh-title' }, 'Flap Happy');
    this.statusEl = h('div', { class: 'fh-status' });

    const iconBtn = (text: string, title: string, fn: () => void, cls = '') =>
      h('button', { class: 'fh-btn fh-icon ' + cls, type: 'button', title, 'aria-label': title, onclick: fn }, text);

    const caps = this.deps.host.capabilities;
    const buttons: HTMLElement[] = [];
    if (caps.alwaysOnTop && !this.deps.info.mainWindow) {
      this.pinBtn = iconBtn('PIN', 'Keep window on top', () => this.toggleAlwaysOnTop(), 'fh-pin');
      buttons.push(this.pinBtn);
    }
    this.saveBtn = h('button', { class: 'fh-btn fh-save', type: 'button', title: 'Save profile', disabled: true, onclick: () => void this.saveProfile() }, 'Save') as HTMLButtonElement;
    if(!this.deps.info.mainWindow)buttons.push(this.saveBtn);
    if (!this.deps.info.mainWindow) buttons.push(iconBtn('\u2699', 'Settings', () => this.openSettings(), 'fh-cog'));
    if (this.deps.compact && caps.compact) buttons.push(iconBtn('\u00d7', 'Close', () => this.deps.host.quit(), 'fh-close'));

    const header = h('div', { class: 'fh-header' }, h('div', { class: 'fh-head-text' }, this.titleEl, this.statusEl), h('div', { class: 'fh-head-btns' }, ...buttons));
    this.profileControls=h('div',{class:'fh-profile-controls'});
    if (this.deps.info.mainWindow) {
      this.externalBtn = h('button', { class: 'fh-btn fh-external-toggle', type: 'button', onclick: () => void this.toggleExternal() }, 'Show external panel') as HTMLButtonElement;
      this.launchCheck = h('input', { class: 'fh-external-launch', type: 'checkbox', checked: this.settings.ui.external_panel_on_launch,
        onchange: (e: Event) => { this.settings.ui.external_panel_on_launch = (e.target as HTMLInputElement).checked; this.persistSoon(); } }) as HTMLInputElement;
      this.mainConnection=h('div',{class:'fh-main-value fh-main-connection'},'Waiting for MSFS');
      this.mainAircraft=h('div',{class:'fh-main-value fh-main-aircraft'},'Aircraft not detected');
      this.mainActiveProfile=h('div',{class:'fh-main-value fh-main-active-profile'},'None');
      this.mainProfileSource=h('div',{class:'fh-main-meta fh-profile-current'},'No active profile');
      this.mainExternalState=h('span',{class:'fh-main-external-state'},'Closed');
      const card=(label:string,value:HTMLElement,meta?:HTMLElement)=>h('div',{class:'fh-main-status-card'},h('div',{class:'fh-main-kicker'},label),value,meta);
      const controls=h('div',{class:'fh-main-controls'},
        h('div',{class:'fh-main-heading'},h('div',null,h('h1',null,'Flap Happy'),h('p',{class:'fh-main-copy'},'Glider flap guidance for Microsoft Flight Simulator 2024')),h('button',{class:'fh-btn fh-main-settings',type:'button',onclick:()=>this.openSettings(this.panelUpdatePending?'panel':'display')},'Settings')),
        h('div',{class:'fh-main-status-grid'},card('Simulator connection',this.mainConnection),card('Detected aircraft',this.mainAircraft),card('Active profile',this.mainActiveProfile,this.mainProfileSource)),
        h('div',{class:'fh-main-section'},h('div',{class:'fh-main-section-heading'},h('h2',null,'Profile selection'),h('button',{class:'fh-btn fh-main-profiles',type:'button',onclick:()=>this.openSettings('profiles')},'Edit profiles')),this.profileControls),
        h('div',{class:'fh-main-section fh-main-external'},h('div',{class:'fh-main-section-heading'},h('h2',null,'External panel'),this.mainExternalState),h('div',{class:'fh-main-actions'},this.externalBtn),h('label',{class:'fh-check fh-main-launch'},this.launchCheck,' Open the external panel on launch'),
          h('p',{class:'fh-hint'},this.deps.info.panelAvailable?'The in-sim display remains available while the main app runs.':'Panel feed unavailable. Check that another instance is not using the cockpit port.')));
      this.displayView=h('div',{class:'fh-display fh-main-display'},controls);
      this.paintExternal();
    } else {
      this.displayView = h('div', { class: 'fh-display' }, header, this.profileControls, this.strip!.el);
    }
    this.settingsHost = h('div', { class: 'fh-settings-host' });
    root.appendChild(this.displayView);
    root.appendChild(this.settingsHost);
    if (this.deps.info.dev && this.deps.mountDevPanel) {
      const dev = h('div', { class: 'fh-dev' });
      root.appendChild(dev);
      this.deps.mountDevPanel(dev, this);
    }
  }

  clearAvailableWsgProfiles():void{
    this.catalogGeneration++;this.mainWsgCatalog=null;this.catalogLoading=null;this.mainWsgStatus='';this.paintProfileControls();
  }

  loadAvailableWsgProfiles():Promise<WsgCatalog>{
    if(!this.host.getPublishedWsgCatalog)return Promise.reject(Error('WSG profiles are disabled'));
    if(this.catalogLoading)return this.catalogLoading;
    const generation=++this.catalogGeneration;
    this.mainWsgStatus='Loading WSG.org profiles...';this.paintProfileControls();
    const pending=this.host.getPublishedWsgCatalog().then(catalog=>{
      if(generation===this.catalogGeneration){
        this.mainWsgCatalog=catalog;this.mainWsgStatus=catalog.profiles.length+' published WSG profiles';this.paintProfileControls();
      }
      return catalog;
    },error=>{
      if(generation===this.catalogGeneration){this.mainWsgCatalog=null;this.mainWsgStatus='WSG.org unavailable; local profiles still work.';this.paintProfileControls();}
      throw error;
    }).finally(()=>{if(this.catalogLoading===pending)this.catalogLoading=null;});
    this.catalogLoading=pending;return pending;
  }

  /** The live app's selection controls are deliberately separate from profile definition fields. */
  private paintProfileControls():void {
    if(!this.profileControls)return;
    const root=this.profileControls;
    root.style.display=this.deps.info.mainWindow||this.strictLiveSelection()?'':'none';
    if(!this.deps.info.mainWindow&&!this.strictLiveSelection())return;
    const choice=this.settings.profile_selection;
    const candidates=this.metas.filter(m=>!m.error);
    const demos=this.usingSim?candidates.filter(m=>m.virtual):[];
    const locals=candidates.filter(m=>!(m.virtual));
    const published=this.mainWsgCatalog?.profiles??[];
    const validPublished=(key:string)=>published.some(p=>('WSG:'+p.variantKey)===key);
    const canUsePublished=(p:WsgCatalog['profiles'][number])=>!!wsgFlightProfile({variantKey:p.variantKey,displayName:p.variantKey,profile:p},this.settings.wsg_profile_overrides);
    const signature=JSON.stringify([choice,this.usingSim,candidates.map(m=>[m.id,m.incomplete,m.virtual]),published.map(p=>[p.variantKey,canUsePublished(p)]),this.mainWsgStatus,this.settings.wsg_profiles_enabled,this.profile?.id,this.activeProfileSource,this.detectedWsgVariant]);
    if(signature===this.profileControlsSignature)return;
    this.profileControlsSignature=signature;
    clear(root);
    const select=h('select',{class:'fh-in fh-profile-mode','aria-label':'Profile mode'},h('option',{value:'auto'},'Auto-detect'),h('option',{value:'manual'},'Manual')) as HTMLSelectElement;
    select.value=choice.mode;select.addEventListener('change',()=>this.setProfileSelection(select.value==='manual'?'manual':'auto'));
    const field=choice.mode==='manual'?'manualId':'fallbackId';
    const picker=h('select',{class:'fh-in fh-profile-choice','aria-label':choice.mode==='manual'?'Active profile':'Fallback profile'},h('option',{value:''},'None'),
      h('optgroup',{label:'Custom profiles'},...locals.map(m=>h('option',{value:m.id,disabled:m.incomplete},profileLabel(m.id)+(m.incomplete?' (needs input)':'')))),
      demos.length?h('optgroup',{label:'Demo examples (offline)'},...demos.map(m=>h('option',{value:m.id},profileLabel(m.id.replace(/^demo-/,''))))):null,
      published.length?h('optgroup',{label:'WSG.org published profiles'},...published.map(p=>h('option',{value:'WSG:'+p.variantKey,disabled:!canUsePublished(p)},p.variantKey+(canUsePublished(p)?'':' (needs profile review)')))):null) as HTMLSelectElement;
    const saved=choice[field];if(saved&&!candidates.some(m=>m.id===saved)&&!validPublished(saved))picker.appendChild(h('option',{value:saved},saved+' (unavailable)'));
    picker.value=saved??'';picker.addEventListener('change',()=>this.setProfileSelection(choice.mode,field,picker.value||null));
    const source=this.profile?this.activeProfileSource==='wsg'?'WSG published profile':this.activeProfileSource==='fallback'?'Fallback profile':this.activeProfileSource==='manual'?'Manual profile':this.activeProfileSource==='assigned'?'Assigned local profile':'Matched local profile':this.detectedWsgVariant?'WSG '+this.detectedWsgVariant+' (no active profile)':'No active profile';
    root.appendChild(h('label',{},'Profile mode',select));root.appendChild(h('label',{},choice.mode==='manual'?'Active profile':'Fallback profile',picker));
    if(!this.deps.info.mainWindow)root.appendChild(h('div',{class:'fh-profile-current',role:'status'},source+(this.profile?': '+profileLabel(this.profile.id):'')));
    if(this.mainWsgStatus)root.appendChild(h('div',{class:'fh-hint fh-picker-wsg-status'},this.mainWsgStatus));
  }

  private installDrop(doc:Document=document): void {
    const stop = (e: Event) => {
      e.preventDefault();
    };
    doc.addEventListener('dragover', stop);
    doc.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => this.importText(String(r.result), f.name);
      r.readAsText(f);
    });
  }

  importText(text: string, name: string): void {
    const parsed = parseProfileJson(text);
    if (!parsed.profile) {
      this.pendingImport = { name, profile: null, errors: parsed.errors, validation: null };
    } else {
      const p = parsed.profile;
      p.source = 'user';
      this.pendingImport = { name, profile: p, errors: [], validation: validateProfile(p) };
    }
    this.openSettings();
    if (this.settingsView) this.settingsView.setImport(this.pendingImport);
  }

  consumeImport(): ImportDraft | null {
    const p = this.pendingImport;
    this.pendingImport = null;
    return p;
  }

  // ------------------------------------------------------------- Data source

  private startSource(): void {
    const d = this.deps;
    d.sim.stop();
    if (d.realSource) d.realSource.stop();
    this.resolver.reset();
    this.smoothIas = null;
    this.smoothAgl = null;
    this.lastSample = null;
    if(!this.deps.info.mainWindow){this.lastTitle = null;this.liveBindingKey = null;}
    this.liveSelectionGeneration++;
    this.manualPick = false;
    if (!this.deps.info.mainWindow&&this.strictLiveSelection()) {
      this.clearLiveProfile('Waiting for MSFS aircraft.');
      if(this.settings.profile_selection.mode==='manual')this.refreshLiveProfileSelection();
    }
    if (d.info.mainWindow && d.realSource) {
      d.realSource.start((s) => this.onSample(s));
      if (this.usingSim) d.sim.start(() => {}); // synthetic control updates only; the session emits samples
    } else if (this.usingSim) {
      this.syncSimToProfile();
      d.sim.start((s) => this.onSample(s));
    } else if (d.realSource) {
      d.realSource.start((s) => this.onSample(s));
      d.realSource.setLvarName?.(this.profile ? this.profile.current_flap.lvar_name : null);
    }
  }

  setDemoMode(on: boolean): void {
    this.settings.ui.demo_mode = on;
    this.usingSim = on || this.deps.info.source === 'simulated' || !this.deps.realSource;
    this.startSource();
    this.persistSoon();
    this.renderAll();
  }

  /** Keep Demo controls consistent with the selected profile, not each telemetry sample. */
  syncSimToProfile(): void {
    const p = this.profile;
    const sim = this.deps.sim;
    if (!p) return;
    sim.setLvarName(p.current_flap.lvar_name);
    if(this.usingSim&&sim.primeProfile(p))sim.tick(0);
  }

  private onSample(s: SimSample): void {
    const now = Date.now();
    const previousCount=this.lastSample?.flapCount;
    this.lastSample = s;
    this.lastRx = this.deps.info.source === 'replay' && !this.usingSim ? now : s.t;
    if (!this.deps.info.mainWindow&&this.strictLiveSelection()) {
      const title = s.connected && s.aircraftTitle?.trim() ? s.aircraftTitle : null;
      const binding = title ? this.bindingForSample(s, title) : null;
      if (binding !== this.liveBindingKey) {
        this.lastTitle = title;
        this.liveBindingKey = binding;
        const generation = ++this.liveSelectionGeneration;
        this.clearLiveProfile(title ? 'No profile for this aircraft. Choose a custom profile in Settings.' : 'Waiting for MSFS aircraft.');
        if (title && binding || this.settings.profile_selection.mode==='manual') void this.selectForLiveAircraft(title, binding, generation, s);
      } else if(previousCount!==s.flapCount&&this.activeWsgMatch&&(!this.profile||this.activeProfileSource==='fallback'||this.activeProfileSource==='local')&&this.settings.profile_selection.mode==='auto') {
        const effective=wsgFlightProfile(this.activeWsgMatch,this.settings.wsg_profile_overrides);
        if(effective&&validateProfile(effective,{liveHandleCount:s.flapCount}).ok){this.activeProfileSource='wsg';this.setActiveProfile(effective,true);}
      }
    } else if (!this.deps.info.mainWindow&&s.connected && s.aircraftTitle && s.aircraftTitle !== this.lastTitle) {
      this.lastTitle = s.aircraftTitle;
      void this.autoSelectForTitle(s.aircraftTitle);
    }
    if (s.connected && this.profile) {
      const dt = this.smoothAt ? now - this.smoothAt : 0;
      const tau = this.profile.marker_smoothing_ms;
      if (s.iasKt !== null) this.smoothIas = smoothStep(this.smoothIas, s.iasKt, dt, tau);
      else this.smoothIas = null;
      if (s.aglFt !== null) this.smoothAgl = smoothStep(this.smoothAgl, s.aglFt, dt, tau);
      else this.smoothAgl = null;
      this.smoothAt = now;
    } else {
      this.smoothIas = null;
      this.smoothAgl = null;
    }
    this.renderAll();
  }

  private async readRuntimeState():Promise<void>{
    const state=await window.flapHappyBridge?.invoke('panel:getState') as CockpitState|null;
    if(state)this.syncRuntimeState(state);
  }
  private syncRuntimeState(state:CockpitState):void{
    if(!this.deps.info.mainWindow)return;
    this.lastTitle=state.aircraftTitle??null;this.liveBindingKey=state.aircraftBindingKey??null;
    this.detectedWsgVariant=state.detectedWsgVariant??null;this.activeProfileSource=state.profileSource??'none';
    this.noProfileMessage=state.noProfileMessage??'';
    const changed=this.profile?.id!==state.profile?.id;
    const inherited=state.launchUnits??{};
    if(JSON.stringify(inherited)!==JSON.stringify(this.launchUnits)){this.launchUnits={...inherited};this.settingsView?.launchUnitsChanged();}
    this.profile=state.profile;
    if(this.usingSim&&state.ready){if(this.deps.sim.primeProfile(this.profile))this.deps.sim.tick(0);}
    this.validation=this.profile?validateProfile(this.profile,{liveHandleCount:state.sample?.flapCount}):null;
    if(this.profile&&!this.profile.wsg)this.settings.last_profile_id=this.profile.id;
    this.ballast={f:state.ballast,unconfirmed:false,restored:false};
    if(changed){this.resolver.reset();this.smoothIas=this.smoothAgl=null;}
    if(state.sample&&state.receivedAt>=this.lastRx){this.lastSample=state.sample;this.lastRx=state.receivedAt;}
    this.renderAll();
  }

  private strictLiveSelection(): boolean {
    return !this.usingSim && this.deps.info.source === 'simconnect';
  }

  private bindingForSample(s: SimSample, title: string): string {
    const span = s.wingSpanM;
    return s.aircraftContainer && typeof span === 'number' && isFinite(span) && span > 0
      ? JSON.stringify([title, s.aircraftContainer.toLowerCase(), Math.round(span * 10) / 10]) : title;
  }

  refreshLiveProfileSelection(): void {
    if(this.deps.info.mainWindow){void this.persistNow();return;}
    if (!this.strictLiveSelection()) return;
    const generation=++this.liveSelectionGeneration;
    this.clearLiveProfile(this.lastTitle?'No profile for this aircraft. Choose a custom profile in Settings.':'Waiting for MSFS aircraft.');
    if(this.lastSample) void this.selectForLiveAircraft(this.lastTitle,this.liveBindingKey,generation,this.lastSample);
    else if(this.settings.profile_selection.mode==='manual') void this.applyLocalChoice(resolveProfileChoice(this.metas,this.settings,null,null,{pending:false,usableVariantKey:null}),generation);
  }

  setProfileSelection(mode:'auto'|'manual',field?:'manualId'|'fallbackId',id?:string|null):void {
    this.settings.profile_selection.mode=mode;
    if(field) this.settings.profile_selection[field]=id??null;
    if(this.deps.info.mainWindow)void this.persistNow();else{this.persistSoon();this.refreshLiveProfileSelection();}
  }

  private clearLiveProfile(message: string): void {
    this.profile = null;
    this.validation = null;
    this.noProfileMessage = message;
    this.detectedWsgVariant = null;
    this.activeWsgMatch=null;
    this.activeProfileSource = 'none';
    this.resolver.reset();
    this.deps.realSource?.setLvarName?.(null);
    this.smoothIas = this.smoothAgl = null;
    this.renderAll();
  }

  private async applyLocalChoice(choice:ReturnType<typeof resolveProfileChoice>,generation:number):Promise<void> {
    if(!('id' in choice)||generation!==this.liveSelectionGeneration)return;
    if(this.profile?.id!==choice.id)await this.activate(choice.id,false,generation);
    if(generation===this.liveSelectionGeneration&&this.profile?.id===choice.id){this.activeProfileSource=choice.kind;this.renderAll();}
  }

  private async selectForLiveAircraft(title: string|null, binding: string|null, generation: number, sample: SimSample): Promise<void> {
    const host=this.deps.host;
    const mightLookup=!!(host.matchWsgAircraft&&sample.aircraftContainer&&sample.wingSpanM);
    const first=resolveProfileChoice(this.metas,this.settings,title,binding,{pending:mightLookup,usableVariantKey:null});
    if(first.kind!=='pending'){await this.applyLocalChoice(first,generation);return;}
    try {
      const matched=await host.matchWsgAircraft!(sample.aircraftContainer!,sample.wingSpanM!);
      if(generation!==this.liveSelectionGeneration||binding!==this.liveBindingKey)return;
      this.detectedWsgVariant=matched?.variantKey??null;
      this.activeWsgMatch=matched;
      const effective=matched?wsgFlightProfile(matched,this.settings.wsg_profile_overrides):null;
      const validation=effective?validateProfile(effective,{liveHandleCount:this.lastSample?.flapCount}):null;
      if(effective){
        const choice=resolveProfileChoice(this.metas,this.settings,title,binding,{pending:false,usableVariantKey:matched!.variantKey});
        if(choice.kind==='wsg'&&validation?.ok){
          this.activeWsgMatch=matched;this.activeProfileSource='wsg';this.setActiveProfile(effective,true);return;
        }
      }
      if(matched)this.noProfileMessage=validation?.errors.find(e=>e.code==='wsg-live-count')?.message??(matched.profile
        ? 'WSG '+matched.variantKey+': profile or local overrides incompatible. Check Settings.'
        : 'WSG '+matched.variantKey+': no published flap profile. Choose a custom profile in Settings.');
    }catch{/* Offline: use only explicitly configured fallback or unique local title rule. */}
    if(generation!==this.liveSelectionGeneration)return;
    await this.applyLocalChoice(resolveProfileChoice(this.metas,this.settings,title,binding,{pending:false,usableVariantKey:null}),generation);
    this.renderAll();
  }

  /** Re-resolve saved edits against the exact already-confirmed aircraft, without
   * a second network dependency during editing. */
  refreshWsgAdjustments(key:string):void {
    if(this.deps.info.mainWindow){void this.readRuntimeState();return;}
    if(this.activeWsgMatch?.variantKey!==key||this.settings.profile_selection.mode!=='auto')return;
    if(this.profile&&!this.profile.wsg&&this.activeProfileSource!=='fallback'&&this.activeProfileSource!=='local')return;
    const next=wsgFlightProfile(this.activeWsgMatch,this.settings.wsg_profile_overrides);
    if(next&&validateProfile(next,{liveHandleCount:this.lastSample?.flapCount}).ok){this.activeProfileSource='wsg';this.setActiveProfile(next,false);}
    else this.refreshLiveProfileSelection();
  }

  private async autoSelectForTitle(title: string): Promise<void> {
    if (this.settingsView) return;
    const id = selectProfileId(this.metas, this.settings, title);
    if (id && (!this.profile || this.profile.id !== id) && (!this.manualPick || this.settings.active_by_title[title])) {
      await this.activate(id, false);
    }
  }

  // ---------------------------------------------------------------- Profiles

  async refreshMetas(): Promise<void> {
    this.metas = await this.deps.store.list();
  }

  async deleteLocalProfile(id:string):Promise<void>{
    await this.refreshMetas();const meta=this.metas.find(p=>p.id===id);
    if(!id||id!==sanitizeId(id)||!meta||meta.virtual)throw Error('Only saved local profiles may be deleted.');
    await this.deps.store.remove(id);
    if(this.deps.info.mainWindow){this.settings=await this.deps.store.getSettings();await this.readRuntimeState();await this.refreshMetas();this.renderAll();return;}
    forgetLocalProfile(this.settings,id);if(this.profile?.id===id)this.clearLiveProfile('No active profile');
    await this.refreshMetas();await this.persistNow();this.refreshLiveProfileSelection();this.renderAll();
  }

  /** Make a stored profile the active one. `manual` remembers the choice for the current aircraft title. */
  async activate(id: string, manual: boolean, generation?: number): Promise<void> {
    const binding = this.liveBindingKey;
    if (manual && this.strictLiveSelection()) ++this.liveSelectionGeneration;
    let p: Profile;
    try {
      p = await this.deps.store.load(id);
    } catch {
      return;
    }
    if (this.strictLiveSelection() && (binding !== this.liveBindingKey || (generation !== undefined && generation !== this.liveSelectionGeneration))) return;
    if(this.deps.info.mainWindow){
      if(manual){if(this.settings.profile_selection.mode==='manual')this.settings.profile_selection.manualId=id;
        else if(this.liveBindingKey)this.settings.active_by_title[this.liveBindingKey]=id;
        else if(this.lastTitle)this.settings.active_by_title[this.lastTitle]=id;}
      this.settings.last_profile_id=id;this.setUnsaved(null);await this.persistNow();return;
    }
    if (manual) {
      this.manualPick = true;
      const key = this.strictLiveSelection() ? binding : this.lastTitle;
      if(this.strictLiveSelection()&&this.settings.profile_selection.mode==='manual'){this.settings.profile_selection.manualId=id;this.activeProfileSource='manual';}
      else if (key) {this.settings.active_by_title[key] = id;this.activeProfileSource='assigned';}
    }
    this.settings.last_profile_id = id;
    if (manual || !this.strictLiveSelection() || !this.unsaved) this.setUnsaved(null);
    this.setActiveProfile(p, true);
    if (this.deps.info.mainWindow) await this.persistNow();
    else this.persistSoon();
  }

  /** Remember an edited profile until Save. Passing null clears the unsaved copy. */
  setUnsaved(p: Profile | null, weightMode = weightModeForProfile(p), intendedBinding = this.liveBindingKey): void {
    if (!p) this.unsavedBindingKey = null;
    else if (!this.unsaved || this.unsaved.id !== p.id) this.unsavedBindingKey = intendedBinding;
    this.unsaved = p ? cloneProfile(p) : null;
    this.unsavedWeightMode = p ? weightMode : 'manual';
    this.paintSaveButton();
  }

  private paintSaveButton(): void {
    if (!this.saveBtn) return;
    const dirty = this.unsaved !== null;
    this.saveBtn.disabled = !dirty || !canSaveWeightMode(this.unsaved, this.unsavedWeightMode);
    toggleClass(this.saveBtn, 'dirty', dirty);
  }

  /**
   * Write a profile and apply it when it is valid. Uses the unsaved draft when no profile is passed.
   * Returns whether the display switched to the saved profile.
   */
  async saveProfile(p?: Profile, weightMode = p ? weightModeForProfile(p) : this.unsavedWeightMode): Promise<boolean> {
    const draft = p ?? this.unsaved;
    if (!draft || draft.wsg || !canSaveWeightMode(draft, weightMode)) return false;
    const d = profileForWeightMode(draft, weightMode);
    const intendedBinding = this.unsaved?.id === d.id ? this.unsavedBindingKey : this.liveBindingKey;
    await this.deps.store.save(d);
    await this.refreshMetas();
    if (this.strictLiveSelection() && (!intendedBinding || intendedBinding !== this.liveBindingKey)) {
      // Aircraft changed while editing; preserve the file but do not bind it to a different aircraft.
      this.setUnsaved(null);
      return false;
    }
    const newlySelected = this.profile?.id !== d.id;
    const did = this.setActiveProfile(cloneProfile(d), false);
    if (did && newlySelected) {
      // Saving a newly created local profile is an explicit selection, just like the picker.
      // Retain it for this exact aircraft title across restart; never guess an alias.
      this.manualPick = true;
      const key = this.strictLiveSelection() ? this.liveBindingKey : this.lastTitle;
      if(this.strictLiveSelection()&&this.settings.profile_selection.mode==='manual'){this.settings.profile_selection.manualId=d.id;this.activeProfileSource='manual';}
      else if (key) {this.settings.active_by_title[key] = d.id;this.activeProfileSource='assigned';}
      if (this.strictLiveSelection()) ++this.liveSelectionGeneration;
    }
    this.settings.last_profile_id = d.id;
    if(did&&this.deps.info.mainWindow){if(this.settings.profile_selection.mode==='manual')this.settings.profile_selection.manualId=d.id;else if(this.liveBindingKey)this.settings.active_by_title[this.liveBindingKey]=d.id;else if(this.lastTitle)this.settings.active_by_title[this.lastTitle]=d.id;}
    if (this.deps.info.mainWindow) await this.persistNow();
    else this.persistSoon();
    this.setUnsaved(null);
    return did;
  }

  /** Apply a profile to the live display. Invalid drafts do not replace a valid profile of the same id. */
  setActiveProfile(p: Profile, restoreBallast: boolean): boolean {
    const v = validateProfile(p, { liveHandleCount: this.liveCount() });
    const prevValid = this.profile && this.validation && this.validation.ok;
    if (!v.ok && prevValid && this.profile && this.profile.id === p.id) return false;
    const changed = !this.profile || this.profile.id !== p.id || usesManualBallast(this.profile) !== usesManualBallast(p);
    this.profile = p;
    this.noProfileMessage = '';
    this.validation = v;
    if (changed || restoreBallast) this.ballast = initialBallast(p, this.settings.ballast_by_profile[p.id]);
    this.resolver.reset();
    this.syncSimToProfile();
    if (this.deps.realSource && !this.usingSim) this.deps.realSource.setLvarName?.(p.current_flap.lvar_name);
    this.renderAll();
    return true;
  }

  liveCount(): number | null {
    const s = this.lastSample;
    return s && s.connected && s.flapCount !== null && s.flapCount > 0 ? s.flapCount : null;
  }

  setSpeedUnit(unit:SpeedUnit): void {
    if(this.launchUnits.units!==undefined)return;
    this.settings.units = unit;
    this.persistSoon();
    this.renderAll();
  }

  setHeightUnit(unit: 'ft' | 'm'): void {
    if(this.launchUnits.height!==undefined)return;
    this.settings.height = unit;
    this.persistSoon();
    this.renderAll();
  }

  setWeightUnit(unit:WeightUnit):void { if(this.launchUnits.weight_unit!==undefined)return;this.settings.weight_unit=unit;this.persistSoon();this.renderAll(); }
  setWindUnit(unit:WindUnit):void { if(this.launchUnits.wind_unit!==undefined)return;this.settings.wind_unit=unit;this.persistSoon();this.renderAll(); }

  setManualBallast(f: number, touched: boolean,fromMain=false): void {
    if (!usesManualBallast(this.profile) || !this.profile || !isFinite(f)) return;
    this.ballast = { f: clamp01(f), unconfirmed: touched ? false : this.ballast.unconfirmed, restored: touched ? false : this.ballast.restored };
    this.settings.ballast_by_profile[this.profile.id] = this.ballast.f;
    if(this.deps.info.mainWindow){if(!fromMain)void window.flapHappyBridge?.invoke('panel:setBallast',this.profile.id,this.ballast.f);}else this.persistSoon();
    this.renderAll();
  }

  /** Demo scenarios may synthesize weight for an anchored profile; never affect live telemetry. */
  setBallast(f: number, touched: boolean): void {
    const p = this.profile;
    if (!p || !isFinite(f)) return;
    if (usesManualBallast(p)) { this.setManualBallast(f, touched); return; }
    if (!this.usingSim || !validWeightAnchors(p)) return;
    this.sim.controls.totalWeightKg = p.weight_kg.light! + Math.max(0, Math.min(1, f)) * (p.weight_kg.heavy! - p.weight_kg.light!);
    this.sim.tick(0);
  }

  currentBoundaries(): number[] | null {
    const w = liveWeight(this.profile, this.lastSample, deriveLink(this.lastSample, this.lastRx, Date.now()) === 'live');
    const fraction = interpolationFraction(this.profile, w, this.ballast.f);
    return this.profile && this.validation?.ok && fraction !== null ? (this.profile.wsg?wsgBoundaries(this.profile,fraction):effectiveBoundaries(this.profile, fraction)) : null;
  }

  // ------------------------------------------------------------------ Window

  private toggleAlwaysOnTop(): void {
    this.settings.ui.always_on_top = !this.settings.ui.always_on_top;
    this.deps.host.setAlwaysOnTop(this.settings.ui.always_on_top);
    this.persistSoon();
    this.renderAll();
  }

  setOpacity(o: number): void {
    this.settings.ui.opacity = o;
    this.deps.host.setOpacity(o);
    this.persistSoon();
  }

  setZoom(z: number): void {
    this.settings.ui.zoom = z;
    this.persistSoon();
    this.renderAll();
  }

  setAlwaysOnTop(on: boolean): void {
    this.settings.ui.always_on_top = on;
    this.deps.host.setAlwaysOnTop(on);
    this.persistSoon();
    this.renderAll();
  }

  setShowBallast(on: boolean): void {
    this.settings.ui.show_ballast = on;
    this.persistSoon();
    this.renderAll();
  }

  setAutoHideExternal(on:boolean):void {
    this.settings.ui.auto_hide_external=on;
    this.persistSoon();this.renderAll();
  }

  setShowAgl(on: boolean): void {
    this.settings.ui.show_agl = on;
    this.persistSoon();
    this.renderAll();
  }

  setSimpleFlap(on: boolean): void {
    this.settings.ui.simple_flap = on;
    this.persistSoon();
    this.renderAll();
  }

  setGroupHiddenFlapLabels(on: boolean): void {
    this.settings.ui.group_hidden_flap_labels = on;
    this.persistSoon();
    this.renderAll();
  }

  setShowTransitions(on: boolean): void {
    this.settings.ui.show_transitions = on;
    this.persistSoon();
    this.renderAll();
  }

  setHighlightRecommended(on:boolean):void{
    this.settings.ui.highlight_recommended=on;
    this.persistSoon();this.renderAll();
  }

  setShowWind(on: boolean): void {
    this.settings.ui.show_wind = on;
    this.persistSoon();
    this.renderAll();
  }

  setBarShading(on: boolean): void {
    this.settings.ui.bar_shading = on;
    this.persistSoon();
    this.renderAll();
  }

  setAglEdge(key: 'bottom_m' | 'top_m' | 'low_m' | 'high_m', metres: number): void {
    if (!isFinite(metres)) return;
    this.settings.agl[key] = Math.max(0, Math.min(18288, Math.round(metres * 100) / 100));
    this.persistSoon();
    this.renderAll();
  }

  private applyHostSettings(): void {
    const u = this.settings.ui;
    if (this.deps.host.capabilities.alwaysOnTop && u.always_on_top) this.deps.host.setAlwaysOnTop(true);
    if (this.deps.host.capabilities.opacity && u.opacity < 1) this.deps.host.setOpacity(u.opacity);
  }

  // ---------------------------------------------------------------- Settings

  openSettings(area:SettingsArea='profiles'): void {
    if (this.settingsView) { this.settingsView.selectArea(area);this.profileEditorWindow?.focus();return; }
    this.settingsView = new SettingsView(this,area);
    clear(this.settingsHost);
    // Electron live mode uses a separate native editor. It owns no telemetry or
    // persistence service; the controls work against this same App instance.
    if(this.deps.info.mainWindow&&window.flapHappyBridge){
      try{
        const editor=window.open('about:blank','flaphappy-profiles','popup,width=760,height=760');
        if(editor){
          this.profileEditorWindow=editor;
          editor.document.title='Flap Happy - Settings';
          const link=document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
          if(link){const css=editor.document.createElement('link');css.rel='stylesheet';css.href=link.href;editor.document.head.appendChild(css);}
          const root=editor.document.createElement('main');root.className='fh-root';editor.document.body.appendChild(root);
          root.appendChild(this.settingsView.el);
          this.installDrop(editor.document);
          editor.addEventListener('beforeunload',()=>{if(this.profileEditorWindow===editor){this.profileEditorWindow=null;this.closeSettings();}});
          editor.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&(e.target as HTMLElement|null)?.tagName!=='SELECT'){e.preventDefault();this.closeSettings();}});
          editor.focus();void this.settingsView.init();return;
        }
      }catch{/* The browser harness or a blocked child can still open settings inline. */this.profileEditorWindow?.close();this.profileEditorWindow=null;}
    }
    this.settingsHost.appendChild(this.settingsView.el);
    if (!this.deps.info.mainWindow) this.displayView.style.display = 'none';
    this.settingsHost.style.display = 'block';
    void this.settingsView.init();
  }

  closeSettings(): void {
    if (!this.settingsView) return;
    this.settingsView.dispose();
    this.settingsView = null;
    this.onModel = null;
    const editor=this.profileEditorWindow;this.profileEditorWindow=null;
    if(editor&&!editor.closed)editor.close();
    clear(this.settingsHost);
    this.settingsHost.style.display = 'none';
    this.displayView.style.display = 'block';
    void this.refreshMetas();
    this.renderAll();
  }

  get settingsOpen(): boolean {
    return !!this.settingsView;
  }

  // -------------------------------------------------------------- Persisting

  persistSoon(): void {
    if (this.deps.info.mainWindow) { void this.persistNow().catch(e => console.error('Could not save panel settings', e)); return; }
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.persistNow(), SAVE_DEBOUNCE_MS);
  }

  async persistNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.deps.store.setSettings(this.settings);
    if(this.deps.info.mainWindow){await this.readRuntimeState();await this.refreshMetas();}
  }

  // ---------------------------------------------------------------- Rendering

  buildModelFor(profile: Profile | null, validation: ValidationResult | null): DisplayModel {
    const now = Date.now();
    const link = deriveLink(this.lastSample, this.lastRx, now);
    const resolver = profile === this.profile ? this.resolver : new CurrentFlapResolver();
    const flap = profile
      ? resolver.resolve(profile, this.lastSample, now)
      : ({ status: 'unknown', rowIndex: null, label: null, handleIndex: null, via: null } as CurrentFlap);
    if (profile === this.profile) this.flap = flap;
    return buildDisplayModel({
      profile,
      validation:profile?.wsg?validateProfile(profile,{liveHandleCount:this.lastSample?.flapCount}):validation,
      sample: this.lastSample,
      link,
      manualBallast: this.ballast.f,
      ias: this.smoothIas,
      aglFt: this.smoothAgl,
      flap,
      units: this.displayUnits.units,
      height: this.displayUnits.height,
      windUnit: this.displayUnits.wind_unit,
      agl: this.settings.agl,
      groupHiddenFlapLabels: this.settings.ui.group_hidden_flap_labels,
    });
  }

  renderAll(): void {
    if (!this.displayView) return;
    const model = this.buildModelFor(this.profile, this.validation);
    if (!this.profile && this.strictLiveSelection() && this.noProfileMessage) model.incompleteMessage = this.noProfileMessage;
    this.lastModel = model;
    this.slider?.render(this.profile, model.weight, this.ballast,this.displayUnits.weight_unit);
    this.strip?.render(model, { profile: this.profile, zoom: this.settings.ui.zoom, showBallast: this.settings.ui.show_ballast, showAgl: this.settings.ui.show_agl, simpleFlap: this.settings.ui.simple_flap, showTransitions: this.settings.ui.show_transitions, highlightRecommended:this.settings.ui.highlight_recommended, showWind: this.settings.ui.show_wind, barShading: this.settings.ui.bar_shading });
    setText(this.titleEl, this.profile ? profileLabel(this.profile.id) : 'Flap Happy');
    const bits: string[] = [];
    if (model.statusText) bits.push(model.statusText);else if(this.deps.info.mainWindow&&model.link==='live')bits.push('Connected');
    if (this.strictLiveSelection() && this.profile && this.activeProfileSource==='fallback') bits.push('Fallback profile');
    if (this.usingSim) bits.push('DEMO');
    if (model.mode === 'noflaps') bits.push('no flaps');
    setText(this.statusEl, bits.join('  |  '));
    toggleClass(this.statusEl, 'warn', model.link !== 'live');
    if (this.pinBtn) toggleClass(this.pinBtn, 'on', this.settings.ui.always_on_top);
    this.paintSaveButton();
    this.paintProfileControls();
    this.paintMainStatus(model);
    if (this.onModel) this.onModel();
  }

  private paintMainStatus(model:DisplayModel):void{
    if(!this.mainConnection||!this.mainAircraft||!this.mainActiveProfile||!this.mainProfileSource)return;
    const connected=this.usingSim?'Demo (simulated)':this.deps.info.source==='replay'?(model.link==='live'?'Replay (simulated)':'Replay waiting'):model.link==='live'?'Connected to MSFS':model.link==='paused'?'Connected / paused':model.link==='nodata'?'MSFS data unavailable':'Waiting for MSFS';
    setText(this.mainConnection,connected);
    this.mainConnection.classList.toggle('fh-main-live',model.link==='live');
    setText(this.mainAircraft,this.lastSample?.connected&&this.lastSample.aircraftTitle?this.lastSample.aircraftTitle+(model.link==='nodata'?' (last seen)':''):'Aircraft not detected');
    setText(this.mainActiveProfile,this.profile?this.profile.id:'None');
    const type=this.profile?.wsg?'WSG.org':this.profile&&this.metas.some(m=>m.id===this.profile?.id&&m.virtual)?'Demo example':this.profile?'Custom profile':'No active profile';
    const source=this.activeProfileSource==='manual'?'Manual selection':this.activeProfileSource==='fallback'?'Fallback':this.activeProfileSource==='assigned'?'Aircraft assignment':this.activeProfileSource==='local'||this.activeProfileSource==='wsg'?'Auto-detected':'';
    setText(this.mainProfileSource,type+(this.profile&&source?' - '+source:'')+(model.incompleteMessage?.startsWith('Flap count mismatch')?' - '+model.incompleteMessage:''));
  }

  private paintExternal(): void {
    if (!this.externalBtn) return;
    if(this.mainExternalState)setText(this.mainExternalState,this.externalOpen?'Open':'Closed');
    this.externalBtn.textContent = this.externalOpen ? 'Close external panel' : 'Show external panel';
    this.externalBtn.disabled = !this.deps.info.panelAvailable;
    this.externalBtn.setAttribute('aria-pressed', String(this.externalOpen));
  }

  private async toggleExternal(): Promise<void> {
    if (!this.externalBtn || !this.host.setExternalPanel) return;
    this.externalBtn.disabled = true;
    try { this.externalOpen = await this.host.setExternalPanel(!this.externalOpen); }
    catch (e) { console.error('Could not change external panel', e); }
    finally { this.paintExternal(); }
  }

  exportText(p: Profile): string {
    return exportProfileJson(p);
  }
}
