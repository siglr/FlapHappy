import type { Profile, ValidationResult } from '../core/types';
import {
  addRow,
  cloneProfile,
  createBlankProfile,
  sanitizeId,
  deleteRow,
  exportProfileJson,
  moveLabel,
  profileLabel,
  transitionName,
} from '../core/profile';
import { formatSpeedField, heightToMetres, heightUnitLabel, metresToHeight, unitLabel, unitToKnots, type SpeedUnit } from '../core/units';
import { validateProfile } from '../core/validate';
import type { WsgCatalog, WsgPublishedProfile } from '../core/wsg-catalog';
import { mappingIdentity, resetWsgOverrides, resolveWsgOverrides, transitionIdentity, wsgStallContext, type WsgOverrides } from '../core/wsg-overrides';
import { canSaveWeightMode, profileForWeightMode, weightModeForProfile, type WeightMode } from '../core/weight';
import { clear, fmtNum, h, numberOrNull, setText, toggleClass } from './dom';
import type { App } from './app';
import type { PanelInstallStatus,PanelInstallResult,PanelDestination } from '../core/panel-install';

export interface ImportDraft {
  name: string;
  profile: Profile | null;
  errors: string[];
  validation: ValidationResult | null;
}

type Field = HTMLInputElement | HTMLSelectElement;

export class SettingsView {
  readonly el: HTMLElement;
  private draft: Profile | null = null;
  private weightMode: WeightMode = 'manual';
  private draftBindingKey: string | null = null;
  private previousWeights: Profile['weight_kg'] | null = null;
  private saveAsBtn: HTMLButtonElement | null = null;
  private profilePicker: HTMLSelectElement | null = null;
  private newProfileBtn: HTMLButtonElement | null = null;
  private discardBtn: HTMLButtonElement | null = null;
  private profileBusy = false;
  private mappingOpen = false;
  private displayOptionsOpen = false;
  private wsgCatalog: WsgCatalog | null = null;
  private wsgPreview: WsgPublishedProfile | null = null;
  private wsgStatus = '';
  private wsgGeneration = 0;
  private validation: ValidationResult | null = null;
  private prefilled: number[] = [];
  private undo: { profile: Profile; what: string } | null = null;
  private fields: Record<string, Field> = {};
  private transNames: HTMLElement[] = [];
  private rowEls: HTMLElement[] = [];
  private saveBtn: HTMLButtonElement;
  private saveState: HTMLElement;
  private dirty = false;

  private displayBox:HTMLElement;
  private profileBar: HTMLElement;
  private banner: HTMLElement;
  private table: HTMLElement;
  private tools: HTMLElement;
  private panel: HTMLElement;
  private liveLine: HTMLElement;
  private validBox: HTMLElement;
  private advanced: HTMLElement;
  private appBox: HTMLElement;
  private dragStop: (() => void) | null = null;
  private aglInputs: HTMLInputElement[] = [];
  private aglUnits: HTMLElement[] = [];

  constructor(private app: App) {
    this.saveBtn = h('button', { class: 'fh-btn fh-save', type: 'button', disabled: true, onclick: () => void this.saveNow() }, 'Save') as HTMLButtonElement;
    this.saveState = h('span', { class: 'fh-savestate' });
    this.displayBox=h('div',{class:'fh-display-settings'});
    this.profileBar = h('div', { class: 'fh-pbar' });
    this.banner = h('div', { class: 'fh-banner' });
    this.table = h('div', { class: 'fh-table' });
    this.tools = h('div', { class: 'fh-tools' });
    this.panel = h('div', { class: 'fh-subpanel' });
    this.liveLine = h('div', { class: 'fh-liveline' });
    this.validBox = h('div', { class: 'fh-validbox' });
    this.advanced = h('div', { class: 'fh-advanced' });
    this.appBox = h('div', { class: 'fh-appbox' });

    const back = h('button', { class: 'fh-btn fh-back', type: 'button', onclick: () => this.close() }, app.info.mainWindow ? 'Close settings' : '\u2190 Back to display');
    this.el = h(
      'div',
      { class: 'fh-settings' },
      h('div', { class: 'fh-sethead' }, back, h('div', { class: 'fh-settitle' }, 'Settings'), this.saveBtn, this.saveState),
      this.displayBox,
      this.profileBar,
      this.banner,
      this.table,
      this.tools,
      this.panel,
      this.liveLine,
      this.validBox,
      this.advanced,
      this.appBox,
    );
  }

  async init(): Promise<void> {
    await this.app.refreshMetas();
    const imp = this.app.consumeImport();
    if (this.app.unsaved) this.draft = cloneProfile(this.app.unsaved);
    else if (this.app.profile && !this.app.profile.wsg) this.draft = cloneProfile(this.app.profile);
    this.weightMode = this.app.unsaved ? this.app.unsavedWeightMode : weightModeForProfile(this.draft);
    this.draftBindingKey = this.app.unsaved ? this.app.draftAircraftBindingKey : this.app.currentAircraftBindingKey;
    this.mappingOpen = this.draft?.flaps.length === 0;
    this.dirty = !!this.app.unsaved;
    this.revalidate();
    this.renderAll();
    if (imp) this.setImport(imp);
    if (this.dirty) {
      toggleClass(this.saveState, 'dirty', true);
      setText(this.saveState, 'Unsaved');
    }
    this.paintSaveState();
    this.app.onModel = () => this.updateLive();
    this.updateLive();
    if (this.app.host.getPublishedWsgCatalog) void this.loadWsgCatalog();
  }

  dispose(): void {
    this.wsgGeneration++;
    this.endDrag();
    if (this.dirty && this.draft) this.app.setUnsaved(this.draft, this.weightMode, this.draftBindingKey);
  }

  private close(): void {
    this.app.closeSettings();
  }

  // ------------------------------------------------------------------ Drafts

  private revalidate(): void {
    this.validation = this.draft ? validateProfile(this.draft, { liveHandleCount: this.app.liveCount(), requireWeightAnchors: this.weightMode === 'live' }) : null;
  }

  /** After any edit: re-validate and refresh field states. The file is written only from Save. */
  private edited(structural: boolean): void {
    this.revalidate();
    if (structural) this.renderTable();
    this.updateFieldStates();
    this.renderValidation();
    this.updateLive();
    this.dirty = true;
    if (this.draft) this.app.setUnsaved(this.draft, this.weightMode, this.draftBindingKey);
    toggleClass(this.saveState, 'dirty', true);
    setText(this.saveState, 'Unsaved');
    this.paintSaveState();
  }

  async saveNow(): Promise<void> {
    const draft = this.draft;
    if (this.wsgPreview || !draft || !canSaveWeightMode(draft, this.weightMode)) return;
    const d = profileForWeightMode(draft, this.weightMode);
    this.draft = d;
    const applied = !!(this.validation && this.validation.ok);
    const did = await this.app.saveProfile(d, this.weightMode);
    this.dirty = false;
    toggleClass(this.saveState, 'dirty', false);
    setText(this.saveState, applied && did ? 'Saved and applied' : applied ? 'Saved' : 'Saved as incomplete. Not applied: fix errors');
    this.renderProfileBar();
    this.paintSaveState();
    this.updateLive();
  }

  private paintSaveState(): void {
    const canSave = !this.wsgPreview && canSaveWeightMode(this.draft, this.weightMode);
    this.saveBtn.disabled = !this.dirty || !canSave;
    if (this.saveAsBtn) this.saveAsBtn.disabled = !canSave;
    if (this.profilePicker) this.profilePicker.disabled = this.dirty || this.profileBusy;
    if (this.newProfileBtn) this.newProfileBtn.disabled = this.dirty || this.profileBusy;
    if (this.discardBtn) this.discardBtn.style.display = this.dirty ? '' : 'none';
    toggleClass(this.saveBtn, 'dirty', this.dirty);
  }

  private setDraft(p: Profile | null): void {
    this.wsgPreview = null;
    this.draft = p;
    this.draftBindingKey = this.app.currentAircraftBindingKey;
    this.weightMode = weightModeForProfile(p);
    this.previousWeights = null;
    this.mappingOpen = p?.flaps.length === 0;
    this.dirty = false;
    this.app.setUnsaved(null);
    this.prefilled = [];
    this.undo = null;
    clear(this.panel);
    this.revalidate();
    this.renderAll();
    this.paintSaveState();
  }

  private mutate(next: Profile, what?: string, prefilled?: number | null): void {
    if (!this.draft) return;
    if (what) this.undo = { profile: cloneProfile(this.draft), what };
    this.draft = next;
    this.prefilled = this.prefilled.filter(() => false);
    if (prefilled !== undefined && prefilled !== null) this.prefilled.push(prefilled);
    this.edited(true);
  }

  // --------------------------------------------------------------- Rendering

  private setUnits(unit: SpeedUnit): void {
    this.app.setSpeedUnit(unit);
    this.renderProfileBar();
    this.renderTable();
    this.updateFieldStates();
  }

  private setHeight(unit: 'ft' | 'm'): void {
    this.app.setHeightUnit(unit);
    this.renderProfileBar();
    this.syncAglFields();
  }

  private syncAglFields(): void {
    const unit = this.app.settings.height === 'm' ? 'm' : 'ft';
    const keys: Array<'bottom_m' | 'top_m' | 'low_m' | 'high_m'> = ['bottom_m', 'top_m', 'low_m', 'high_m'];
    for (let i = 0; i < this.aglInputs.length; i++) this.aglInputs[i].value = String(metresToHeight(this.app.settings.agl[keys[i]], unit));
    for (let i = 0; i < this.aglUnits.length; i++) setText(this.aglUnits[i], heightUnitLabel(unit));
  }

  private renderAll(): void {
    this.renderProfileBar();
    this.renderTable();
    this.renderTools();
    this.renderValidation();
    this.renderAdvanced();
    this.renderAppBox();
    this.updateFieldStates();
    this.updateLive();
  }

  private renderProfileBar(): void {
    const app = this.app;
    const previousOptions = this.displayBox.querySelector<HTMLDetailsElement>('.fh-display-options');
    if (previousOptions) this.displayOptionsOpen = previousOptions.open;
    clear(this.displayBox);
    clear(this.profileBar);
    const files = app.host.capabilities.files;
    const unit = app.settings.units === 'kmh' ? 'kmh' : 'kt';
    const height = app.settings.height === 'm' ? 'm' : 'ft';
    const unitBtn = (id: SpeedUnit, label: string) =>
      h('button', { class: 'fh-btn fh-unitbtn' + (unit === id ? ' on' : ''), type: 'button', onclick: () => this.setUnits(id) }, label);
    const heightBtn = (id: 'ft' | 'm', label: string) =>
      h('button', { class: 'fh-btn fh-unitbtn' + (height === id ? ' on' : ''), type: 'button', onclick: () => this.setHeight(id) }, label);
    const u = app.settings.ui;
    const sw = (cls: string, on: boolean, label: string, set: (v: boolean) => void, enabled = true) =>
      h('label', { class: 'fh-slide' + (enabled ? '' : ' off') }, h('input', { type: 'checkbox', class: cls, 'aria-label': label, checked: on, disabled: !enabled, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }), h('span', { class: 'fh-slidetrack' }, h('span', { class: 'fh-slideknob' })));
    const row = (label: string, control: HTMLElement, enabled = true) => h('div', { class: 'fh-optrow' }, h('span', { class: 'fh-unitlab' + (enabled ? '' : ' off') }, label), control);
    const toggles = h('div', { class: 'fh-toggles' }, h('div', { class: 'fh-optrow' }, h('span', { class: 'fh-unitlab' }, 'Speed'), h('span', { class: 'fh-units' }, unitBtn('kt', 'kt'), unitBtn('kmh', 'km/h'))), h('div', { class: 'fh-optrow' }, h('span', { class: 'fh-unitlab' }, 'Altitude'), h('span', { class: 'fh-units fh-height' }, heightBtn('ft', 'ft'), heightBtn('m', 'm'))), row('Simple flap indicator', sw('fh-simple-flap', u.simple_flap, 'Simple flap indicator', (v) => { const focused = this.el.ownerDocument.activeElement?.classList.contains('fh-simple-flap'); app.setSimpleFlap(v); this.renderProfileBar(); if (focused) this.displayBox.querySelector<HTMLInputElement>('.fh-simple-flap')?.focus(); })), row('Flap transitions', sw('fh-show-transitions', u.show_transitions, 'Flap transitions', (v) => app.setShowTransitions(v), !u.simple_flap), !u.simple_flap), row('Highlight suggested flap', sw('fh-highlight-recommended', u.highlight_recommended, 'Highlight suggested flap', (v)=>app.setHighlightRecommended(v), !u.simple_flap), !u.simple_flap), row('Weight / ballast bar', sw('fh-show-ballast', u.show_ballast, 'Weight / ballast bar', (v) => app.setShowBallast(v))), h('div', { class: 'fh-optrow' }, h('span', { class: 'fh-unitlab' }, 'AGL bar'), sw('fh-show-agl', u.show_agl, 'AGL bar', (v) => { app.setShowAgl(v); this.renderProfileBar(); }), h('span', { class: 'fh-unitlab fh-beside' + (u.show_agl ? '' : ' off') }, 'Wind speed'), sw('fh-show-wind', u.show_wind, 'Wind speed', (v) => app.setShowWind(v), u.show_agl)));
    this.saveAsBtn = files ? h('button', { class: 'fh-btn fh-saveas', type: 'button', disabled: !!this.wsgPreview || !canSaveWeightMode(this.draft, this.weightMode), onclick: () => void this.saveAs() }, 'Save As...') as HTMLButtonElement : null;
    const ids = app.metas.map(m => m.id);
    if (this.draft && ids.indexOf(this.draft.id) < 0) ids.push(this.draft.id);
    ids.sort((a, b) => a.localeCompare(b));
    const customFile = h('input', { type: 'file', accept: '.json,application/json', class: 'fh-custom-file', 'aria-label': 'Custom profile JSON', onchange: (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.app.importText(String(reader.result), file.name);
      reader.readAsText(file);
      customFile.value = '';
    } }) as HTMLInputElement;
    customFile.style.display = 'none';
    this.profilePicker = h('select', { class: 'fh-in fh-profile-select', 'aria-label': 'Glider profile', disabled: this.dirty || this.profileBusy,
      onchange: (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        if (id === ':custom') {
          (e.target as HTMLSelectElement).value = this.selectedProfileValue();
          if (files) void this.openFile(); else customFile.click();
        } else if (id.indexOf(':wsg:') === 0) this.previewWsg(id.slice(5));
        else void this.selectProfile(id);
      } }, h('option', { value: '', disabled: true }, 'Select a profile'),
      h('optgroup', { label: 'Local profiles' }, ...ids.map(id => h('option', { value: id }, profileLabel(id)))),
      h('option', { value: ':custom' }, 'Custom profile...'),
      this.wsgCatalog ? h('optgroup', { label: 'WSG.org published profiles (preview)' }, ...this.wsgCatalog.profiles.map(p => h('option', { value: ':wsg:' + p.variantKey }, p.variantKey))) : null) as HTMLSelectElement;
    this.profilePicker.value = this.selectedProfileValue();
    const input = h('input', { class: 'fh-in fh-new-name', type: 'text', maxlength: '64', placeholder: 'Profile name', 'aria-label': 'New profile name' }) as HTMLInputElement;
    const message = h('span', { class: 'fh-hint', role: 'status' });
    const newForm = h('form', { class: 'fh-new-form', onsubmit: (e: Event) => {
      e.preventDefault();
      const id = sanitizeId(input.value);
      if (!id) { setText(message, 'Enter a profile name.'); return; }
      if (ids.indexOf(id) >= 0) { setText(message, 'A profile with that name already exists.'); return; }
      if (this.dirty || this.profileBusy) return;
      this.setDraft(createBlankProfile(id));
      this.edited(false);
      this.table.querySelector<HTMLElement>('.fh-weight-mode')?.focus();
    } }, input, h('button', { type: 'submit', class: 'fh-btn fh-create' }, 'Create'),
      h('button', { type: 'button', class: 'fh-btn', onclick: () => { newForm.style.display = 'none'; } }, 'Cancel'), message);
    newForm.style.display = 'none';
    this.newProfileBtn = h('button', { type: 'button', class: 'fh-btn fh-new', disabled: this.dirty || this.profileBusy, onclick: () => {
      newForm.style.display = 'flex'; input.focus();
    } }, 'New profile') as HTMLButtonElement;
    this.discardBtn = h('button', { type: 'button', class: 'fh-btn fh-discard-edits', onclick: () => this.discardEdits() }, 'Discard edits') as HTMLButtonElement;
    this.discardBtn.style.display = this.dirty ? '' : 'none';
    const profile = h('div', { class: 'fh-profile-top' },
      h('div', { class: 'fh-subtitle' }, 'Glider profile'),
      app.host.getPublishedWsgCatalog ? h('div', { class: 'fh-wsg-source' },
        h('div', { class: 'fh-hint fh-wsg-status', role: 'status' }, this.wsgStatus || 'Loading published WSG.org profiles...')) : null,
      h('div', { class: 'fh-prow' }, this.profilePicker, this.newProfileBtn, this.discardBtn,
        customFile, this.saveAsBtn, app.host.capabilities.openFolder ? h('button', { class: 'fh-btn', type: 'button', onclick: () => app.host.openProfilesFolder() }, 'Open profiles folder') : null),
      newForm);
    this.profileBar.appendChild(profile);
    this.displayBox.appendChild(h('details', { class: 'fh-details fh-display-options', open: this.displayOptionsOpen }, h('summary', null, 'Display (app-wide preferences)'), h('div',{class:'fh-hint'},'These units apply to every glider and both panels.'),toggles));
    if (!this.draft) this.profileBar.appendChild(h('div', { class: 'fh-hint' }, 'No profile yet. Create a local profile or open a JSON file to start.'));
  }

  private selectedProfileValue(): string {
    return this.wsgPreview ? ':wsg:' + this.wsgPreview.variantKey : this.draft?.id ?? '';
  }

  private async loadWsgCatalog(): Promise<void> {
    const host = this.app.host;
    if (!host.getPublishedWsgCatalog) return;
    const generation = ++this.wsgGeneration;
    this.wsgStatus = 'Loading published profiles...';
    this.renderProfileBar();
    try {
      const catalog = await this.app.loadAvailableWsgProfiles();
      if (generation !== this.wsgGeneration) return;
      this.wsgCatalog = catalog;
      this.wsgStatus = catalog.profiles.length + ' published profiles (revision ' + catalog.revision + ')';
    } catch {
      if (generation !== this.wsgGeneration) return;
      this.wsgCatalog = null;
      this.wsgStatus = 'WSG.org profiles unavailable; local profiles still work offline.';
    }
    this.renderProfileBar();
    this.paintSaveState();
    this.updateLive();
  }

  private previewWsg(key: string): void {
    if (this.dirty || !this.wsgCatalog) return;
    const p = this.wsgCatalog.profiles.find(x => x.variantKey === key);
    if (!p) return;
    this.wsgPreview = p;
    this.renderAll();
    this.paintSaveState();
  }

  private async selectProfile(id: string): Promise<void> {
    if (!id || this.dirty || this.profileBusy) return;
    this.profileBusy = true;
    this.paintSaveState();
    try{
      // The editor can read/edit a saved local profile even with no connected
      // aircraft. Only the active selection policy determines flight activation.
      const local=await this.app.store.load(id);
      await this.app.activate(id,true);
      this.setDraft(cloneProfile(local));
    }catch{
      this.renderProfileBar();setText(this.saveState,'Could not open this profile.');
    }finally{this.profileBusy=false;this.paintSaveState();}
  }

  private async discardEdits():Promise<void> {
    if(!this.dirty)return;
    let saved:Profile|null=null;
    if(this.draft){try{saved=await this.app.store.load(this.draft.id);}catch{/* new unsaved profile */}}
    this.setDraft(saved?cloneProfile(saved):this.app.profile&&!this.app.profile.wsg?cloneProfile(this.app.profile):null);
    toggleClass(this.saveState,'dirty',false);setText(this.saveState,'Unsaved changes discarded');
  }

  private fieldInput(path: string, value: string, opts: { cls?: string; placeholder?: string; type?: string; step?: string; onInput: (text: string) => void; label?: string }): HTMLInputElement {
    const inp = h('input', {
      class: 'fh-in ' + (opts.cls ?? ''),
      type: opts.type ?? 'number',
      step: opts.step ?? '0.1',
      value,
      placeholder: opts.placeholder ?? '',
      'aria-label': opts.label ?? path,
      'data-path': path,
      oninput: (e: Event) => {
        const el = e.target as HTMLInputElement;
        const idx = this.prefilled.indexOf(parseTransitionIndex(path));
        if (idx >= 0 && path.indexOf('transitions[') === 0) this.prefilled.splice(idx, 1);
        opts.onInput(el.value);
        this.edited(false);
      },
    }) as HTMLInputElement;
    this.fields[path] = inp;
    return inp;
  }

  private renderTable(): void {
    const oldMapping = this.table.querySelector<HTMLDetailsElement>('.fh-mapping');
    if (oldMapping && oldMapping.getAttribute('data-profile') === this.draft?.id) this.mappingOpen = oldMapping.open;
    clear(this.table);
    this.fields = {};
    this.transNames = [];
    this.rowEls = [];
    if (this.wsgPreview) { this.renderWsgPreview(this.wsgPreview); return; }
    const d = this.draft;
    if (!d) return;
    const n = d.flaps.length;
    const unit = this.app.settings.units === 'kmh' ? 'kmh' : 'kt';
    const left = this.weightMode === 'live' ? 'Light' : 'No ballast';
    const right = this.weightMode === 'live' ? 'Heavy' : 'Max ballast';
    const storeSpeed = (text: string): number | null => {
      const value = numberOrNull(text);
      return value === null ? null : unitToKnots(value, unit);
    };
    const column = (child: HTMLElement | string) => h('div', { class: 'fh-profile-value' }, child);
    const columns = (title: string, a: string, b: string) => h('div', { class: 'fh-profile-grid fh-profile-head' }, h('div', { class: 'fh-profile-title' }, title), column(a), column(b));
    const speedRow = (title: string, cls: string, nameEl: HTMLElement | null, get: () => { no_ballast_kt: number | null; max_ballast_kt: number | null }, path: string, isEnd: boolean) => {
      const pair = get();
      return h('div', { class: 'fh-profile-grid ' + cls }, nameEl ?? h('div', { class: 'fh-profile-title' }, title),
        column(this.fieldInput(path + '.no_ballast_kt', formatSpeedField(pair.no_ballast_kt, unit), { cls: 'fh-speed', step: '1', onInput: (t) => { get().no_ballast_kt = storeSpeed(t); }, label: title + ' ' + left + ' IAS (' + unitLabel(unit) + ')' })),
        column(this.fieldInput(path + '.max_ballast_kt', formatSpeedField(pair.max_ballast_kt, unit), { cls: 'fh-speed', step: '1', placeholder: isEnd ? 'same' : '', onInput: (t) => { get().max_ballast_kt = storeSpeed(t); }, label: title + ' ' + right + ' IAS (' + unitLabel(unit) + ')' })));
    };
    const ref = h('div', { class: 'fh-profile-card' }, h('div', { class: 'fh-subtitle' }, 'Reference weights and stall IAS'));
    const mode = h('select', { class: 'fh-in fh-weight-mode', 'aria-label': 'Flying weight mode', onchange: (e: Event) => this.selectWeightMode((e.target as HTMLSelectElement).value as WeightMode) },
      h('option', { value: 'manual' }, 'Manual ballast slider'), h('option', { value: 'live' }, 'Live flying weight')) as HTMLSelectElement;
    mode.value = this.weightMode;
    ref.appendChild(h('div', { class: 'fh-erow' }, h('label', { class: 'fh-profile-title' }, 'Weight mode'), mode));
    ref.appendChild(columns('', left, right));
    if (this.weightMode === 'live') ref.appendChild(h('div', { class: 'fh-profile-grid' }, h('div', { class: 'fh-profile-title' }, 'Flying weight (kg)'),
      column(this.fieldInput('weight_kg.light', fmtNum(d.weight_kg.light), { cls: 'fh-speed', step: '1', label: 'Light flying weight (kg)', onInput: (t) => { d.weight_kg.light = numberOrNull(t); } })),
      column(this.fieldInput('weight_kg.heavy', fmtNum(d.weight_kg.heavy), { cls: 'fh-speed', step: '1', label: 'Heavy flying weight (kg)', onInput: (t) => { d.weight_kg.heavy = numberOrNull(t); } }))));
    ref.appendChild(speedRow('Stall IAS (' + unitLabel(unit) + ')', 'fh-minrow', null, () => d.vs_min, 'vs_min', true));
    ref.appendChild(h('div', { class: 'fh-hint' }, this.weightMode === 'live' ? 'Both loaded weights are required; Light must be below Heavy.' : 'No flying weights are required. Set the manual ballast slider in flight.'));
    this.table.appendChild(ref);
    const transitions = h('div', { class: 'fh-profile-card' }, h('div', { class: 'fh-subtitle' }, 'Flap transitions — IAS (' + unitLabel(unit) + ')'), columns('From → To', left, right));
    for (let i = 0; i < n - 1; i++) {
      const nameEl = h('div', { class: 'fh-profile-title fh-transname' }, this.transitionLabel(d, i));
      this.transNames.push(nameEl);
      const trow = speedRow(this.transitionLabel(d, i), 'fh-transition-row fh-trow', nameEl, () => d.transitions[i], `transitions[${i}]`, false);
      if (this.prefilled.indexOf(i) >= 0) trow.classList.add('prefilled');
      const excluded=h('input',{type:'checkbox',checked:d.transitions[i].exclude_from_display===true,'aria-label':'Exclude '+transitionName(d,i)+' from display',onchange:(e:Event)=>{
        d.transitions[i].exclude_from_display=(e.target as HTMLInputElement).checked;this.edited(false);
      }});
      transitions.appendChild(trow);
      transitions.appendChild(h('label',{class:'fh-check fh-exclude-transition'},excluded,' Merge adjoining flap bands (exclude divider)'));
    }
    if (n < 2) transitions.appendChild(h('div', { class: 'fh-hint' }, 'At least two flap positions are needed for a transition. Edit the flap mapping below.'));
    if (n > 0) transitions.appendChild(h('div', { class: 'fh-profile-grid fh-vne-row' }, h('div', { class: 'fh-profile-title' }, 'Max (Vne) (' + unitLabel(unit) + ')'),
      column(this.fieldInput('vne', formatSpeedField(d.vne, unit), { cls: 'fh-speed', step: '1', label: 'Max (Vne)', onInput: (t) => { d.vne = storeSpeed(t); } })), column('')));
    this.table.appendChild(transitions);
    const mapping = h('details', { class: 'fh-details fh-mapping', 'data-profile': d.id, open: this.mappingOpen || n === 0 }, h('summary', null, 'Advanced: flap names and simulator positions'),
      h('div', { class: 'fh-hint' }, 'Define the ordered flap positions. Drag a name to another row; simulator indexes and speed boundaries stay in their existing slots.'));
    d.flaps.forEach((row, i) => {
      const labelIn = this.fieldInput(`flaps[${i}].label`, row.label, { cls: 'fh-lbl', type: 'text', label: 'Flap ' + (i + 1) + ' label', onInput: (t) => {
        row.label = t;
        this.transNames.forEach((el, k) => setText(el, this.transitionLabel(d, k)));
      } });
      labelIn.setAttribute('maxlength', '8');
      const indexIn = this.fieldInput(`flaps[${i}].handle_index`, row.handle_index === null ? '' : String(row.handle_index), { cls: 'fh-handle', step: '1', label: 'Flap ' + (i + 1) + ' sim index', onInput: (t) => {
        const value = numberOrNull(t);
        row.handle_index = value === null ? null : Math.round(value);
        frow.setAttribute('data-handle', row.handle_index === null ? '' : String(row.handle_index));
      } });
      indexIn.setAttribute('min', '0');
      const frow = h('div', { class: 'fh-erow fh-frow', 'data-handle': row.handle_index === null ? '' : String(row.handle_index), title: 'Drag to reorder' }, h('span', { class: 'fh-grip', 'aria-hidden': 'true' }, 'â˜°'), h('label', { class: 'fh-sub' }, 'Label'), labelIn, h('label', { class: 'fh-sub' }, 'Sim index'), indexIn,
        h('span', { class: 'fh-rowbtns' }, h('button', { class: 'fh-btn fh-remove', type: 'button', title: 'Remove this flap row', 'aria-label': 'Remove row', onclick: () => this.mutate(deleteRow(d, i), 'Deleted row "' + row.label + '"') }, 'Ã—')));
      this.armRowDrag(frow, i);
      this.rowEls.push(frow);
      mapping.appendChild(frow);
    });
    mapping.appendChild(this.tools);
    this.table.appendChild(mapping);
  }

  /** Published baseline is read-only; personal adjustments are local and sparse. */
  private renderWsgPreview(p: WsgPublishedProfile): void {
    const unit = this.app.settings.units === 'kmh' ? 'kmh' : 'kt';
    const speed = (kt: number | null) => kt === null ? 'Not published' : formatSpeedField(kt, unit);
    const cell = (v: string) => h('div', { class: 'fh-profile-value' }, v);
    const row = (name: string, l: string, r: string) => h('div', { class: 'fh-profile-grid' }, h('div', { class: 'fh-profile-title' }, name), cell(l), cell(r));
    this.table.appendChild(h('div', { class: 'fh-profile-card fh-wsg-preview' },
      h('div', { class: 'fh-subtitle' }, p.variantKey + ' — published WSG.org profile'),
      h('div', { class: 'fh-hint' }, 'Published baseline. Personal adjustments below are local; WSG profiles default to live weight.'),
      row('', 'Light', 'Heavy'), row('Flying weight (kg)', String(p.lightWeightKg), String(p.heavyWeightKg)),
      row('Stall IAS (' + unitLabel(unit) + ')', speed(p.lightStallIasKph === null ? null : p.lightStallIasKph / 1.852), speed(p.heavyStallIasKph === null ? null : p.heavyStallIasKph / 1.852)),
      h('div', { class: 'fh-hint' }, 'An IAS upper limit is not published. Without a personal IAS limit, the upper ribbon edge is visual only.')));
    const transitions = h('div', { class: 'fh-profile-card fh-wsg-transitions' }, h('div', { class: 'fh-subtitle' }, 'Published transition IAS (' + unitLabel(unit) + ')'), row('From → To', 'Light', 'Heavy'));
    for (let i = 1; i < p.bands.length; i++) {
      const b = p.bands[i], from = p.bands[i - 1];
      transitions.appendChild(row(from.label + ' → ' + b.label + (b.excludeFromDisplay ? ' (Hide)' : ' (Show)'), speed(b.lightStartKt), speed(b.heavyStartKt)));
    }
    transitions.appendChild(h('div', { class: 'fh-hint' }, 'Hidden transitions merge adjacent flap positions. The underlying native mapping is unchanged.'));
    this.table.appendChild(transitions);
    this.renderWsgAdjustments(p);
  }

  /** Local edits are staged separately; empty override fields inherit current WSG defaults. */
  private renderWsgAdjustments(p: WsgPublishedProfile): void {
    const app=this.app;
    const prior=app.settings.wsg_profile_overrides[p.variantKey];
    const current=resolveWsgOverrides(p,app.settings.wsg_profile_overrides);
    const box=h('div',{class:'fh-profile-card fh-wsg-adjustments'},h('div',{class:'fh-subtitle'},'Personal WSG adjustments'));
    const status=h('div',{class:'fh-hint fh-wsg-adjustment-status',role:'status'},current.state==='ok'?'Leave an input blank to inherit its current WSG default. Saved edits stay on this device.':'Saved overrides do not match the current definition. Reset or review before editing.');
    box.appendChild(status);
    const mode=h('select',{class:'fh-in fh-wsg-ballast', 'aria-label':'Personal ballast mode'},h('option',{value:'inherit'},'WSG default (Live flying weight)'),h('option',{value:'manual'},'Manual ballast slider'),h('option',{value:'live'},'Live flying weight')) as HTMLSelectElement;
    mode.value=prior?.ballastMode??'inherit';
    box.appendChild(h('label',{class:'fh-profile-grid'},h('span',{class:'fh-profile-title'},'Ballast mode'),mode));
    const number=(key:string,published:number|null,override:number|null|undefined)=>h('input',{class:'fh-in',type:'number',min:'0',step:'any',placeholder:published===null?'Not published':String(published),value:typeof override==='number'?String(override):'','aria-label':key,'data-wsg-override':key}) as HTMLInputElement;
    const l=number('lightWeightKg',p.lightWeightKg,prior?.lightWeightKg), r=number('heavyWeightKg',p.heavyWeightKg,prior?.heavyWeightKg);
    const ls=number('lightStallIasKph',p.lightStallIasKph,prior?.lightStallIasKph), rs=number('heavyStallIasKph',p.heavyStallIasKph,prior?.heavyStallIasKph);
    const row=(name:string,...controls:HTMLElement[])=>h('div',{class:'fh-profile-grid'},h('div',{class:'fh-profile-title'},name),...controls);
    box.appendChild(row('Flying weight (kg)',l,r));box.appendChild(row('Stall IAS (km/h)',ls,rs));
    box.appendChild(h('div',{class:'fh-hint'},'Stall IAS refers to the detent before the first shown transition and the exact Light/Heavy weights. Changing either requires both personal stall IAS values to enable the warning.'));
    let stallTouched=false;ls.addEventListener('input',()=>{stallTouched=true;});rs.addEventListener('input',()=>{stallTouched=true;});
    const confirmStall=h('input',{type:'checkbox',class:'fh-confirm-stall-context'}) as HTMLInputElement;
    box.appendChild(h('label',{class:'fh-check'},confirmStall,' Confirm saved stall IAS pair for the current weights and first visible flap transition'));
    const upper=number('upperIasKph',null,prior?.upperIasKph);box.appendChild(row('Personal upper IAS limit (km/h)',upper));
    box.appendChild(h('div',{class:'fh-hint'},'Speed overrides below are IAS in km/h; published reference weights are retained even in Manual ballast mode.'));
    const rows=p.bands.slice(1).map((b,i)=>{
      const id=transitionIdentity(p.bands[i],b),t=prior?.transitions?.[id];
      const light=number('transition '+i+' Light',b.lightStartKt*1.852,t?.lightStartKt===undefined?undefined:t.lightStartKt*1.852),heavy=number('transition '+i+' Heavy',b.heavyStartKt*1.852,t?.heavyStartKt===undefined?undefined:t.heavyStartKt*1.852);
      const visibility=h('select',{class:'fh-in','aria-label':'Transition '+i+' visibility'},h('option',{value:'inherit'},'WSG default ('+(b.excludeFromDisplay?'Hide':'Show')+')'),h('option',{value:'show'},'Show'),h('option',{value:'hide'},'Hide')) as HTMLSelectElement;
      visibility.value=t?.excludeFromDisplay===undefined?'inherit':t.excludeFromDisplay?'hide':'show';
      box.appendChild(row(p.bands[i].label+' → '+b.label,light,heavy));box.appendChild(row('In-flight display',visibility));
      return {id,light,heavy,visibility};
    });
    const save=h('button',{type:'button',class:'fh-btn fh-wsg-save-adjustments',disabled:current.state!=='ok',onclick:async()=>{
      const read=(el:HTMLInputElement)=>{if(!el.value.trim())return undefined;const n=el.valueAsNumber;if(!isFinite(n)||n<=0)throw Error('Enter positive numbers or leave the fields blank.');return n;};
      try{
        const o:WsgOverrides={mapping:mappingIdentity(p),transitions:{}};
        if(mode.value==='manual'||mode.value==='live')o.ballastMode=mode.value;
        const vals={lightWeightKg:read(l),heavyWeightKg:read(r),lightStallIasKph:read(ls),heavyStallIasKph:read(rs),upperIasKph:read(upper)};
        for(const k of Object.keys(vals) as (keyof typeof vals)[])if(vals[k]!==undefined)o[k]=vals[k];
        for(const x of rows){const a=read(x.light),b=read(x.heavy);const t:{lightStartKt?:number;heavyStartKt?:number;excludeFromDisplay?:boolean}={};if(a!==undefined)t.lightStartKt=a/1.852;if(b!==undefined)t.heavyStartKt=b/1.852;if(x.visibility.value!=='inherit')t.excludeFromDisplay=x.visibility.value==='hide';if(Object.keys(t).length)o.transitions![x.id]=t;}
        const context=wsgStallContext(p,o);
        if(o.lightStallIasKph!==undefined||o.heavyStallIasKph!==undefined){
          if(stallTouched||confirmStall.checked){
            if(!context)throw Error('A stall pair needs a first visible transition.');
            if(context!==wsgStallContext(p)&&(o.lightStallIasKph===undefined||o.heavyStallIasKph===undefined))throw Error('Changed stall context: supply both IAS values or leave both empty.');
            o.stallContext=context;
          }else if(prior?.stallContext)o.stallContext=prior.stallContext;
        }
        const candidate={...app.settings.wsg_profile_overrides,[p.variantKey]:o};
        if(resolveWsgOverrides(p,candidate).state!=='ok')throw Error('Invalid curve: check ordered IAS, reference weights and both stall values. Changed weights require a complete personal curve.');
        app.settings.wsg_profile_overrides=candidate;await app.persistNow();app.refreshWsgAdjustments(p.variantKey);this.renderAll();const message=this.table.querySelector<HTMLElement>('.fh-wsg-adjustment-status');if(message)setText(message,'Personal adjustments saved locally.');
      }catch(e){setText(status,e instanceof Error?e.message:'Could not save adjustments.');}
    }},'Save personal adjustments');
    const reset=h('button',{type:'button',class:'fh-btn fh-wsg-reset-adjustments',onclick:async()=>{app.settings.wsg_profile_overrides=resetWsgOverrides(app.settings.wsg_profile_overrides,p.variantKey);await app.persistNow();app.refreshWsgAdjustments(p.variantKey);this.renderAll();}},'Reset to WSG defaults');
    box.appendChild(h('div',{class:'fh-tools'},save,reset));this.table.appendChild(box);
  }

  private transitionLabel(p: Profile, i: number): string {
    return transitionName(p, i).replace(' -> ', ' → ');
  }

  private selectWeightMode(mode: WeightMode): void {
    if (!this.draft || mode === this.weightMode || (mode !== 'manual' && mode !== 'live')) return;
    if (mode === 'manual') {
      this.previousWeights = { ...this.draft.weight_kg };
      this.draft.weight_kg = { light: null, heavy: null };
    } else if (this.previousWeights) {
      this.draft.weight_kg = { ...this.previousWeights };
    }
    this.weightMode = mode;
    this.edited(true);
    this.table.querySelector<HTMLElement>('.fh-weight-mode')?.focus();
  }

  /** Drag a row (anywhere but its text field or buttons) to move its label. Mouse and touch only. */
  private armRowDrag(row: HTMLElement, from: number): void {
    const start = (clientX: number, clientY: number, target: EventTarget | null) => {
      if (this.dragStop || overControl(target)) return;
      const view=row.ownerDocument.defaultView??window;
      let moved = false;
      let drop = from;
      let ghost: HTMLElement | null = null;
      let slots: number[] | null = null;
      let gap = 0;
      const move = (x: number, y: number) => {
        if (!moved && Math.abs(y - clientY) < 4) return;
        if (!slots) {
          const rect = row.getBoundingClientRect();
          gap = Math.round(rect.height + 6);
          slots = this.rowEls.map((el) => {
            const r = el.getBoundingClientRect();
            return r.top + r.height / 2;
          });
        }
        moved = true;
        drop = nearestSlot(slots, y);
        toggleClass(row, 'fh-dragging', true);
        this.rowEls.forEach((el, k) => {
          const open = k === drop && k !== from;
          toggleClass(el, 'fh-drop', open);
          el.style.marginTop = open ? gap + 'px' : '';
        });
        ghost = placeGhost(row, ghost, x, y);
      };
      const finish = () => {
        this.dragStop = null;
        view.removeEventListener('mousemove', onMouse);
        view.removeEventListener('mouseup', finish);
        row.removeEventListener('touchmove', onTouch);
        row.removeEventListener('touchend', finish);
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        if (moved && drop !== from && this.draft) this.mutate(moveLabel(this.draft, from, drop));
        else {
          toggleClass(row, 'fh-dragging', false);
          this.rowEls.forEach((el) => {
            toggleClass(el, 'fh-drop', false);
            el.style.marginTop = '';
          });
        }
      };
      const onMouse = (e: MouseEvent) => move(e.clientX, e.clientY);
      const onTouch = (e: TouchEvent) => {
        if (e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault();
      };
      this.dragStop = finish;
      view.addEventListener('mousemove', onMouse);
      view.addEventListener('mouseup', finish);
      // On the row, not the window: a window touch listener cannot cancel scrolling.
      row.addEventListener('touchmove', onTouch);
      row.addEventListener('touchend', finish);
    };
    row.addEventListener('mousedown', (e) => {
      if (overControl(e.target)) return;
      e.preventDefault();
      start(e.clientX, e.clientY, e.target);
    });
    row.addEventListener('touchstart', (e) => {
      if (overControl(e.target) || !e.touches[0]) return;
      e.preventDefault();
      start(e.touches[0].clientX, e.touches[0].clientY, e.target);
    });
  }

  private endDrag(): void {
    if (this.dragStop) this.dragStop();
  }


  private renderTools(): void {
    clear(this.tools);
    if (this.wsgPreview) return;
    const d = this.draft;
    if (!d) return;
    const btn = (text: string, cls: string, fn: () => void) => h('button', { class: 'fh-btn ' + cls, type: 'button', onclick: fn }, text);
    this.tools.appendChild(btn('+ Add flap row', 'fh-addrow', () => { const r = addRow(d); this.mutate(r.profile, undefined, r.prefilled); }));
    if (this.undo) this.tools.appendChild(btn('Undo: ' + this.undo.what, 'fh-undo', () => this.doUndo()));
  }

  private doUndo(): void {
    if (!this.undo) return;
    this.draft = this.undo.profile;
    this.undo = null;
    this.prefilled = [];
    this.edited(true);
    this.renderTools();
  }

  private renderValidation(): void {
    clear(this.validBox);
    this.renderTools();
    if (this.wsgPreview) return;
    const v = this.validation;
    if (!v || !this.draft) return;
    const head = v.errors.length
      ? `Not applied: fix ${v.errors.length} error${v.errors.length === 1 ? '' : 's'}` + (v.warnings.length ? `, ${v.warnings.length} warning${v.warnings.length === 1 ? '' : 's'}` : '')
      : v.warnings.length
        ? `Valid, ${v.warnings.length} warning${v.warnings.length === 1 ? '' : 's'}`
        : 'Valid';
    this.validBox.appendChild(h('div', { class: 'fh-validhead ' + (v.errors.length ? 'err' : v.warnings.length ? 'warn' : 'ok') }, 'Validation: ' + head));
    const list = h('ul', { class: 'fh-issues' });
    v.issues.forEach((i) => list.appendChild(h('li', { class: i.level }, i.message)));
    this.validBox.appendChild(list);
  }

  private updateFieldStates(): void {
    const v = this.validation;
    for (const path of Object.keys(this.fields)) {
      const el = this.fields[path];
      const issues = v ? v.issues.filter((i) => i.path === path) : [];
      const err = issues.some((i) => i.level === 'error');
      const warn = !err && issues.length > 0;
      toggleClass(el, 'err', err);
      toggleClass(el, 'warn', warn);
      el.title = issues.map((i) => i.message).join('\n');
    }
  }

  /** Cheap per-sample update: the live line. */
  updateLive(): void {
    const app = this.app;
    if (!this.wsgPreview && !this.dirty && (!app.profile || !!app.profile.wsg) && app.detectedWsgVariant && this.wsgCatalog?.profiles.some(p => p.variantKey === app.detectedWsgVariant)) {
      this.previewWsg(app.detectedWsgVariant);
      return;
    }
    if (this.wsgPreview) { setText(this.liveLine, this.app.profile?.wsg?.variantKey===this.wsgPreview.variantKey?'Active WSG variant. Personal adjustments apply to this profile.':'Viewing published baseline. Active flight profile is unchanged.'); return; }
    const d = this.draft;
    const s = app.lastSample;
    let live = 'Live: no sim data';
    let liveIdx: number | null = null;
    if (s && s.connected && s.flapIndex !== null) {
      liveIdx = Math.round(s.flapIndex);
      const row = d ? d.flaps.find((r) => r.handle_index === liveIdx) : undefined;
      live = `Live: handle index ${liveIdx}` + (s.flapCount !== null ? ` of ${s.flapCount}` : '') + (row ? ` [flap "${row.label}"]` : '');
    }
    if (this.draft && this.draftBindingKey !== app.currentAircraftBindingKey && app.currentAircraftBindingKey) live += ' | Aircraft changed since this draft was opened; Save keeps the local file only.';
    setText(this.liveLine, live);
    this.rowEls.forEach((r) => toggleClass(r, 'live', liveIdx !== null && r.getAttribute('data-handle') === String(liveIdx)));
  }

  // ------------------------------------------------------------ Advanced page

  private renderAdvanced(): void {
    clear(this.advanced);
    if (this.wsgPreview) return;
    const d = this.draft;
    if (!d) return;
    const num = (label: string, get: () => number | null, set: (v: number | null) => void, step = '1', ph = '') =>
      h('div', { class: 'fh-arow' }, h('label', null, label), h('input', { class: 'fh-in', type: 'number', step, value: fmtNum(get()), placeholder: ph, oninput: (e: Event) => { set(numberOrNull((e.target as HTMLInputElement).value)); this.edited(false); } }));
    const text = (label: string, get: () => string, set: (v: string) => void, ph = '') =>
      h('div', { class: 'fh-arow' }, h('label', null, label), h('input', { class: 'fh-in fh-wide', type: 'text', value: get(), placeholder: ph, oninput: (e: Event) => { set((e.target as HTMLInputElement).value); this.edited(false); } }));

    const height = this.app.settings.height === 'm' ? 'm' : 'ft';
    this.aglInputs = [];
    this.aglUnits = [];
    const aglField = (label: string, key: 'bottom_m' | 'top_m' | 'low_m' | 'high_m') => {
      const input = h('input', { class: 'fh-in', type: 'number', min: '0', step: '1', value: String(metresToHeight(this.app.settings.agl[key], height)), oninput: (e: Event) => { const v = numberOrNull((e.target as HTMLInputElement).value); if (v === null || v < 0) return; this.app.setAglEdge(key, heightToMetres(v, this.app.settings.height === 'm' ? 'm' : 'ft')); } }) as HTMLInputElement;
      const unitEl = h('span', { class: 'fh-pct' }, heightUnitLabel(height));
      this.aglInputs.push(input);
      this.aglUnits.push(unitEl);
      return h('span', { class: 'fh-aglfield' }, h('label', null, label), input, unitEl);
    };
    const body = h('div', { class: 'fh-advbody' },
      h('div', { class: 'fh-subtitle' }, 'Display'),
      num('Marker smoothing (ms, 0 = off)', () => d.marker_smoothing_ms, (v) => { d.marker_smoothing_ms = Math.max(0, v ?? 0); }, '50'),
      h('div', { class: 'fh-arow' }, h('label', null, 'Bar shading'), h('label', { class: 'fh-slide' }, h('input', { type: 'checkbox', class: 'fh-bar-shading', 'aria-label': 'Bar shading', checked: this.app.settings.ui.bar_shading, onchange: (e: Event) => this.app.setBarShading((e.target as HTMLInputElement).checked) }), h('span', { class: 'fh-slidetrack' }, h('span', { class: 'fh-slideknob' })))),
      h('div', { class: 'fh-subtitle' }, 'AGL bar'),
      h('div', { class: 'fh-sub' }, 'The bar runs from Bottom to Top and turns green from Low to High.'),
      h('div', { class: 'fh-arow' }, aglField('Bottom', 'bottom_m'), aglField('Top', 'top_m')),
      h('div', { class: 'fh-arow' }, aglField('Low', 'low_m'), aglField('High', 'high_m')),
      h('div', { class: 'fh-subtitle' }, 'Manual ballast fallback (profiles without both flying weights)'),
      h('div', { class: 'fh-arow' }, h('label', null, 'Default ballast'), h('input', { class: 'fh-in', type: 'number', min: '0', max: '100', step: '5', value: String(Math.round(d.ballast.default_fraction * 100)), oninput: (e: Event) => { const v = numberOrNull((e.target as HTMLInputElement).value); d.ballast.default_fraction = Math.max(0, Math.min(100, v ?? 0)) / 100; this.edited(false); } }), h('span', { class: 'fh-pct' }, '%')),
      h('div', { class: 'fh-arow' }, h('label', null, 'Drag snap'), h('input', { class: 'fh-in', type: 'number', min: '0', max: '100', step: '1', value: String(Math.round(d.ballast.drag_snap * 100)), oninput: (e: Event) => { const v = numberOrNull((e.target as HTMLInputElement).value); d.ballast.drag_snap = Math.max(0, Math.min(100, v ?? 0)) / 100; this.edited(false); } }), h('span', { class: 'fh-pct' }, '%')),
      h('div', { class: 'fh-subtitle' }, 'Aircraft'),
      text('Match aircraft title containing (comma separated)', () => d.match.title_contains.join(', '), (v) => { d.match.title_contains = v.split(',').map((x) => x.trim()).filter(Boolean); }, 'e.g. AS 33'),
      text('Notes', () => d.notes, (v) => { d.notes = v; }),
    );
    const details = h('details', { class: 'fh-details' }, h('summary', null, 'Advanced'), body);
    this.advanced.appendChild(details);
  }

  private renderAppBox(): void {
    clear(this.appBox);
    const app = this.app;
    const caps = app.host.capabilities;
    const u = app.settings.ui;
    const rows: HTMLElement[] = [];
    if (caps.alwaysOnTop) rows.push(h('div', { class: 'fh-arow' }, h('label', { class: 'fh-check' }, h('input', { type: 'checkbox', class: 'fh-aot', checked: u.always_on_top, onchange: (e: Event) => app.setAlwaysOnTop((e.target as HTMLInputElement).checked) }), ' Keep the external panel on top of the sim')));
    if (caps.opacity) rows.push(h('div', { class: 'fh-arow' }, h('label', null, 'External panel opacity'), h('input', { type: 'range', min: '0.3', max: '1', step: '0.05', value: String(u.opacity), oninput: (e: Event) => app.setOpacity(Number((e.target as HTMLInputElement).value)) })));
    rows.push(h('div', { class: 'fh-arow' }, h('label', null, 'Zoom'), h('input', { type: 'range', min: '0.5', max: '2', step: '0.1', value: String(u.zoom), oninput: (e: Event) => app.setZoom(Number((e.target as HTMLInputElement).value)) })));
    rows.push(h('div', { class: 'fh-arow' }, h('label', { class: 'fh-check' }, h('input', { type: 'checkbox', class: 'fh-demo', checked: u.demo_mode, onchange: (e: Event) => app.setDemoMode((e.target as HTMLInputElement).checked) }), ' Demo mode: use simulated data instead of the sim')));
    if (caps.files) {
      rows.push(h('div',{class:'fh-arow'},h('label',{class:'fh-check'},h('input',{type:'checkbox',class:'fh-auto-hide-external',checked:u.auto_hide_external,onchange:(e:Event)=>app.setAutoHideExternal((e.target as HTMLInputElement).checked)}),' Auto-hide from external views (in-sim panel only)')));
    }
    if (app.host.panelStatus) rows.push(this.panelInstallBox());
    rows.push(h('div', { class: 'fh-hint' }, 'Version ' + app.info.version + ' | data source: ' + (app.usingSim ? 'simulated' : app.info.source)));
    this.appBox.appendChild(h('details', { class: 'fh-details' }, h('summary', null, 'Window and app'), ...rows));
  }

  private panelInstallBox(): HTMLElement {
    const app=this.app, host=app.host;
    let busy=false, status:PanelInstallStatus|null=null, generation=0;
    const choice=()=>app.settings.panel_destination;
    const selector=h('select',{'aria-label':'Panel destination'},h('option',{value:'community'},'Default Community'),h('option',{value:'custom'},'Custom folder')) as HTMLSelectElement;
    const target=h('input',{type:'text',readonly:true,'aria-label':'Custom package parent',class:'fh-panel-path'}) as HTMLInputElement;
    const browse=h('button',{type:'button',class:'fh-btn'},'Browse') as HTMLButtonElement;
    const custom=h('div',{class:'fh-arow'},target,browse);
    const enabled=h('input',{type:'checkbox','aria-label':'Enable in-sim panel'}) as HTMLInputElement;
    const version=h('div',{class:'fh-hint'});
    const location=h('div',{class:'fh-hint'});
    const note=h('div',{class:'fh-hint',role:'status'});
    const update=h('button',{type:'button',class:'fh-btn'},'Update') as HTMLButtonElement;
    function paint(message?:string){
      selector.value=choice().kind;selector.disabled=busy;custom.hidden=choice().kind!=='custom';
      custom.style.display=custom.hidden?'none':'';
      target.value=choice().customParent??'';browse.disabled=busy;
      enabled.checked=status?.installed??false;enabled.disabled=busy||!status||!(status.installed?status.canRemove:status.action==='Install');
      update.hidden=status?.action!=='Update'||!status.installed;update.disabled=busy;
      location.hidden=choice().kind!=='community';setText(location,status?.community?'Community: '+status.community:'Community not detected');
      setText(version,status?.installedVersion?'Installed version: '+status.installedVersion:'Installed version: —');
      setText(note,message??status?.message??'Checking installation…');
    }
    function apply(next:PanelInstallStatus){
      status=next;
      if(JSON.stringify(choice())!==JSON.stringify(next.destination)){app.settings.panel_destination=next.destination;app.persistSoon();}
      app.setPanelUpdateIndicator(next);
    }
    async function refresh(next?:PanelDestination){
      const id=++generation;
      if(next){app.settings.panel_destination=next;app.persistSoon();}
      busy=true;status=null;paint();
      try{const result=await host.panelStatus!(choice());if(id===generation)apply(result);}
      catch(e){if(id===generation){busy=false;paint(String(e));return;}}
      if(id===generation){busy=false;paint();}
    }
    async function mutate(action:()=>Promise<PanelInstallResult>){
      if(busy)return;busy=true;paint();
      try{const result=await action();apply(result.status);busy=false;paint(result.ok?undefined:result.message);}
      catch(e){busy=false;paint(String(e));}
    }
    selector.onchange=()=>void refresh({...choice(),kind:selector.value==='custom'?'custom':'community'});
    browse.onclick=async()=>{if(busy)return;busy=true;paint();try{const selected=await host.browsePanelParent!();busy=false;if(selected)await refresh({kind:'custom',customParent:selected});else paint();}catch(e){busy=false;paint(String(e));}};
    enabled.onchange=()=>{const value=enabled.checked;void mutate(()=>host.setPanelInstalled!(choice(),value));};
    update.onclick=()=>void mutate(()=>host.updatePanel!(choice()));
    const box=h('div',{class:'fh-panel-install'},h('strong',null,'In-sim panel'),h('div',{class:'fh-arow'},h('label',{class:'fh-check'},enabled,' Enable in-sim panel')),h('div',{class:'fh-arow'},h('label',null,'Install destination'),selector),custom,location,version,h('div',{class:'fh-arow'},update,note));
    void refresh();return box;
  }

  // ------------------------------------------------------------- File actions

  private async openFile(): Promise<void> {
    const text = await this.app.host.openJson();
    if (text !== null) this.app.importText(text, 'opened file');
  }

  private async saveAs(): Promise<void> {
    if (this.wsgPreview || !this.draft || !canSaveWeightMode(this.draft, this.weightMode)) return;
    const p = profileForWeightMode(this.draft, this.weightMode);
    const ok = await this.app.host.saveJson(p.id + '.flaphappy.json', exportProfileJson(p));
    setText(this.saveState, ok ? 'Exported' : 'Export cancelled');
  }

  setImport(imp: ImportDraft | null): void {
    this.closeImport();
    if (!imp) return;
    toggleClass(this.banner, 'on', true);
    if (!imp.profile) {
      this.banner.appendChild(h('div', { class: 'fh-importbox bad' },
        h('div', { class: 'fh-importtitle' }, 'Cannot open this file'),
        h('div', { class: 'fh-importmsg' }, imp.name + ': ' + imp.errors.join('; ')),
        h('div', { class: 'fh-importbtns' }, h('button', { class: 'fh-btn', type: 'button', onclick: () => this.closeImport() }, 'Dismiss'))));
      return;
    }
    const p = imp.profile;
    const v = imp.validation;
    const summary = v && v.ok ? 'valid' + (v.warnings.length ? ` (${v.warnings.length} warnings)` : '') : `incomplete (${v ? v.errors.length : '?'} errors, can still be accepted as a draft)`;
    this.banner.appendChild(
      h('div', { class: 'fh-importbox' },
        h('div', { class: 'fh-importtitle' }, 'Open "' + profileLabel(p.id) + '"?'),
        h('div', { class: 'fh-importmsg' }, 'From ' + imp.name + ': ' + summary + '.' + (this.dirty ? ' Accepting will discard your current unsaved edits.' : '')),
        h('div', { class: 'fh-importbtns' },
          h('button', { class: 'fh-btn fh-discard', type: 'button', onclick: () => this.closeImport() }, 'Discard'),
          h('button', { class: 'fh-btn fh-accept', type: 'button', onclick: async () => {
            const known = this.app.metas.some((m) => m.id === p.id);
            if (!known) {
              await this.app.store.save(p);
              await this.app.refreshMetas();
            }
            await this.app.activate(p.id, true);
            this.closeImport();
            if (this.app.profile) this.setDraft(cloneProfile(this.app.profile));
          } }, 'Accept'))),
    );
  }

  private closeImport(): void {
    clear(this.banner);
    toggleClass(this.banner, 'on', false);
  }
}

/** A see-through copy of the row, kept under the pointer. The grab point stays where the drag began. */
function placeGhost(row: HTMLElement, ghost: HTMLElement | null, x: number, y: number): HTMLElement {
  if (!ghost) {
    const rect = row.getBoundingClientRect();
    ghost = row.cloneNode(true) as HTMLElement;
    ghost.className = 'fh-erow fh-frow fh-dragghost';
    ghost.style.width = rect.width + 'px';
    const live = row.querySelectorAll('input');
    const copy = ghost.querySelectorAll('input');
    for (let i = 0; i < live.length && i < copy.length; i++) (copy[i] as HTMLInputElement).value = (live[i] as HTMLInputElement).value;
    row.ownerDocument.body.appendChild(ghost);
    ghost.setAttribute('data-off-x', String(x - rect.left));
    ghost.setAttribute('data-off-y', String(y - rect.top));
  }
  const offX = Number(ghost.getAttribute('data-off-x'));
  const offY = Number(ghost.getAttribute('data-off-y'));
  ghost.style.left = (x - offX + (row.ownerDocument.defaultView?.scrollX??0)) + 'px';
  ghost.style.top = (y - offY + (row.ownerDocument.defaultView?.scrollY??0)) + 'px';
  return ghost;
}

function nearestSlot(slots: number[], y: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < slots.length; i++) {
    const dist = Math.abs(y - slots[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function overControl(target: EventTarget | null): boolean {
  let el = target && (target as Element).nodeType===1 ? target as HTMLElement : null;
  while (el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'LABEL') return true;
    if (el.classList.contains('fh-frow')) return false;
    el = el.parentElement;
  }
  return false;
}

function parseTransitionIndex(path: string): number {
  const m = /^transitions\[(\d+)\]/.exec(path);
  return m ? Number(m[1]) : -1;
}
