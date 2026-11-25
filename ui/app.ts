import type { DataSource, Host, HostInfo, ProfileStore, SimSample } from '../core/sim';
import type { CockpitState } from '../core/cockpit';
import type { Profile, ProfileMeta, Settings, ValidationResult } from '../core/types';
import { validateProfile } from '../core/validate';
import { CurrentFlapResolver, type CurrentFlap } from '../core/flapmap';
import { buildDisplayModel, deriveLink, type DisplayModel } from '../core/display-model';
import { canSaveWeightMode, interpolationFraction, liveWeight, profileForWeightMode, usesManualBallast, validWeightAnchors, weightModeForProfile, type WeightMode } from '../core/weight';
import { initialBallast, type BallastState } from '../core/ballast';
import { selectProfileId } from '../core/select';
import { effectiveBoundaries, smoothStep } from '../core/scale';
import { clamp01, cloneProfile, exportProfileJson, parseProfileJson, profileLabel } from '../core/profile';
import { defaultSettings } from '../core/settings';
import { SimulatedSource } from '../adapters/simulated/simulated-source';
import { PRESETS } from '../profiles';
import { clear, h, setText, toggleClass } from './dom';
import { StripView } from './strip';
import { WeightControl } from './slider';
import { SettingsView, type ImportDraft } from './settings';

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
  private strip!: StripView;
  private slider!: WeightControl;
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
    if (this.deps.info.platform !== 'browser') {
      // New install: write each built-in once. An id that is already there is left alone.
      let added = false;
      for (let i = 0; i < PRESETS.length; i++) {
        const id = PRESETS[i].id;
        if (this.metas.some((m) => m.id === id)) continue;
        await this.deps.store.save({ ...PRESETS[i].profile, source: 'user' });
        added = true;
      }
      if (added) {
        this.metas = await this.deps.store.list();
        if (!this.settings.last_profile_id) {
          const preferred = this.metas.find((m) => m.id === 'as33-18m');
          if (preferred) {
            this.settings.last_profile_id = preferred.id;
            await this.deps.store.setSettings(this.settings);
          }
        }
      }
    }
    this.buildUi();
    this.installDrop();

    const id = selectProfileId(this.metas, this.settings, null);
    if (id) await this.activate(id, false);
    else this.renderAll();

    this.usingSim = this.deps.info.source === 'simulated' || this.settings.ui.demo_mode || !this.deps.realSource;
    this.startSource();
    this.applyHostSettings();
    window.flapHappyBridge?.on('panel:ballast', (value) => {
      const change = value as { profileId?: string; f?: number };
      if (change?.profileId === this.profile?.id && typeof change.f === 'number') this.setManualBallast(change.f, true);
    });
    setInterval(() => this.renderAll(), 500);
    if (!this.profile) this.openSettings();
  }

  // ---------------------------------------------------------------- UI shell

  private buildUi(): void {
    const root = this.deps.root;
    clear(root);
    root.className = 'fh-root' + (this.deps.compact ? ' fh-compact' : '');

    this.slider = new WeightControl((f) => this.setManualBallast(f, true));
    this.strip = new StripView({ weightRow: this.slider.el });
    this.titleEl = h('div', { class: 'fh-title' }, 'Flap Happy');
    this.statusEl = h('div', { class: 'fh-status' });

    const iconBtn = (text: string, title: string, fn: () => void, cls = '') =>
      h('button', { class: 'fh-btn fh-icon ' + cls, type: 'button', title, 'aria-label': title, onclick: fn }, text);

    const caps = this.deps.host.capabilities;
    const buttons: HTMLElement[] = [];
    if (caps.alwaysOnTop) {
      this.pinBtn = iconBtn('PIN', 'Keep window on top', () => this.toggleAlwaysOnTop(), 'fh-pin');
      buttons.push(this.pinBtn);
    }
    this.saveBtn = h('button', { class: 'fh-btn fh-save', type: 'button', title: 'Save profile', disabled: true, onclick: () => void this.saveProfile() }, 'Save') as HTMLButtonElement;
    buttons.push(this.saveBtn);
    buttons.push(iconBtn('\u2699', 'Settings', () => this.openSettings(), 'fh-cog'));
    if (this.deps.compact && caps.compact) buttons.push(iconBtn('\u00d7', 'Close', () => this.deps.host.quit(), 'fh-close'));

    const header = h('div', { class: 'fh-header' }, h('div', { class: 'fh-head-text' }, this.titleEl, this.statusEl), h('div', { class: 'fh-head-btns' }, ...buttons));
    this.displayView = h('div', { class: 'fh-display' }, header, this.strip.el);
    this.settingsHost = h('div', { class: 'fh-settings-host' });
    root.appendChild(this.displayView);
    root.appendChild(this.settingsHost);
    if (this.deps.info.dev && this.deps.mountDevPanel) {
      const dev = h('div', { class: 'fh-dev' });
      root.appendChild(dev);
      this.deps.mountDevPanel(dev, this);
    }
  }

  private installDrop(): void {
    const stop = (e: Event) => {
      e.preventDefault();
    };
    document.addEventListener('dragover', stop);
    document.addEventListener('drop', (e) => {
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
    if (this.usingSim) {
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

  /** Keep the simulated L var consistent with the active profile. The flap count stays at the sim's own setting. */
  syncSimToProfile(): void {
    const p = this.profile;
    const sim = this.deps.sim;
    if (!p) return;
    sim.setLvarName(p.current_flap.lvar_name);
  }

  private onSample(s: SimSample): void {
    const now = Date.now();
    this.lastSample = s;
    this.lastRx = this.deps.info.source === 'replay' && !this.usingSim ? now : s.t;
    if (s.connected && s.aircraftTitle && s.aircraftTitle !== this.lastTitle) {
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

  /** Make a stored profile the active one. `manual` remembers the choice for the current aircraft title. */
  async activate(id: string, manual: boolean): Promise<void> {
    let p: Profile;
    try {
      p = await this.deps.store.load(id);
    } catch {
      return;
    }
    if (manual) {
      this.manualPick = true;
      if (this.lastTitle) this.settings.active_by_title[this.lastTitle] = id;
    }
    this.settings.last_profile_id = id;
    this.setUnsaved(null);
    this.setActiveProfile(p, true);
    this.persistSoon();
  }

  /** Remember an edited profile until Save. Passing null clears the unsaved copy. */
  setUnsaved(p: Profile | null, weightMode = weightModeForProfile(p)): void {
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
    if (!draft || !canSaveWeightMode(draft, weightMode)) return false;
    const d = profileForWeightMode(draft, weightMode);
    await this.deps.store.save(d);
    await this.refreshMetas();
    const newlySelected = this.profile?.id !== d.id;
    const did = this.setActiveProfile(cloneProfile(d), false);
    if (did && newlySelected) {
      // Saving a newly created local profile is an explicit selection, just like the picker.
      // Retain it for this exact aircraft title across restart; never guess an alias.
      this.manualPick = true;
      if (this.lastTitle) this.settings.active_by_title[this.lastTitle] = d.id;
    }
    this.settings.last_profile_id = d.id;
    this.persistSoon();
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

  setSpeedUnit(unit: 'kt' | 'kmh'): void {
    this.settings.units = unit;
    this.persistSoon();
    this.renderAll();
  }

  setHeightUnit(unit: 'ft' | 'm'): void {
    this.settings.height = unit;
    this.persistSoon();
    this.renderAll();
  }

  setManualBallast(f: number, touched: boolean): void {
    if (!usesManualBallast(this.profile) || !this.profile || !isFinite(f)) return;
    this.ballast = { f: clamp01(f), unconfirmed: touched ? false : this.ballast.unconfirmed, restored: touched ? false : this.ballast.restored };
    this.settings.ballast_by_profile[this.profile.id] = this.ballast.f;
    this.persistSoon();
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
    return this.profile && this.validation?.ok && fraction !== null ? effectiveBoundaries(this.profile, fraction) : null;
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

  setShowAgl(on: boolean): void {
    this.settings.ui.show_agl = on;
    this.persistSoon();
    this.renderAll();
  }

  setShowTransitions(on: boolean): void {
    this.settings.ui.show_transitions = on;
    this.persistSoon();
    this.renderAll();
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

  openSettings(): void {
    if (this.settingsView) return;
    this.settingsView = new SettingsView(this);
    clear(this.settingsHost);
    this.settingsHost.appendChild(this.settingsView.el);
    this.displayView.style.display = 'none';
    this.settingsHost.style.display = 'block';
    void this.settingsView.init();
  }

  closeSettings(): void {
    if (!this.settingsView) return;
    this.settingsView.dispose();
    this.settingsView = null;
    this.onModel = null;
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
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.persistNow(), SAVE_DEBOUNCE_MS);
  }

  async persistNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.deps.store.setSettings(this.settings);
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
      validation,
      sample: this.lastSample,
      link,
      manualBallast: this.ballast.f,
      ias: this.smoothIas,
      aglFt: this.smoothAgl,
      flap,
      units: this.settings.units,
      height: this.settings.height,
      agl: this.settings.agl,
    });
  }

  renderAll(): void {
    if (!this.strip) return;
    const model = this.buildModelFor(this.profile, this.validation);
    this.lastModel = model;
    this.slider.render(this.profile, model.weight, this.ballast);
    this.strip.render(model, { profile: this.profile, zoom: this.settings.ui.zoom, showBallast: this.settings.ui.show_ballast, showAgl: this.settings.ui.show_agl, showTransitions: this.settings.ui.show_transitions, showWind: this.settings.ui.show_wind, barShading: this.settings.ui.bar_shading });
    setText(this.titleEl, this.profile ? profileLabel(this.profile.id) : 'Flap Happy');
    const bits: string[] = [];
    if (model.statusText) bits.push(model.statusText);
    if (this.usingSim) bits.push('DEMO');
    if (model.mode === 'noflaps') bits.push('no flaps');
    setText(this.statusEl, bits.join('  |  '));
    toggleClass(this.statusEl, 'warn', model.link !== 'live');
    if (this.pinBtn) toggleClass(this.pinBtn, 'on', this.settings.ui.always_on_top);
    this.paintSaveButton();
    if (this.onModel) this.onModel();
    this.publishCockpit();
  }

  /** Hand the live display to the in-sim panel. No-op in the browser harness. */
  private publishCockpit(): void {
    const bridge = window.flapHappyBridge;
    if (!bridge) return;
    const state: CockpitState = {
      ready: true,
      profile: this.profile,
      sample: this.lastSample,
      receivedAt: this.lastRx,
      ballast: this.ballast.f,
      units: this.settings.units === 'kmh' ? 'kmh' : 'kt',
      height: this.settings.height === 'm' ? 'm' : 'ft',
      agl: this.settings.agl,
      zoom: this.settings.ui.zoom,
      showBallast: this.settings.ui.show_ballast,
      showAgl: this.settings.ui.show_agl,
      showTransitions: this.settings.ui.show_transitions,
      showWind: this.settings.ui.show_wind,
      barShading: this.settings.ui.bar_shading,
    };
    void bridge.invoke('panel:state', state);
  }

  exportText(p: Profile): string {
    return exportProfileJson(p);
  }
}
