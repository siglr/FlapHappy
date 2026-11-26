import { defaultSettings,forgetLocalProfile } from '../core/settings';
import type { CockpitState } from '../core/cockpit';
import type { ProfileStore, SimSample } from '../core/sim';
import type { Profile, Settings } from '../core/types';
import { initialBallast } from '../core/ballast';
import { clamp01,sanitizeId,cloneProfile } from '../core/profile';
import { aircraftBindingKey,resolveProfileChoice,selectProfileId } from '../core/select';
import { usesManualBallast } from '../core/weight';
import { wsgFlightProfile } from '../core/wsg-flight';
import type { WsgAircraftMatch } from '../core/wsg-reference';
import { validateProfile } from '../core/validate';
import { DEMO_EXAMPLES } from '../profiles';

/** Main-process session for both panels. It does not depend on a renderer. */
export class PanelRuntime {
  private state: CockpitState = { ready: false, profile: null, sample: null, receivedAt: 0, ballast: 0, units: 'kt', height:'ft', agl:defaultSettings().agl, zoom: 1, showBallast:true,showAgl:true,autoHideExternal:false,simpleFlap:false,showTransitions:false,groupHiddenFlapLabels:false,highlightRecommended:false,showWind:true,barShading:true };
  private title: string | null = null;
  private generation = 0;
  private binding:string|null=null;
  private sourceKind='simulated';
  private strictReplay=false;
  private strictSelection():boolean{return this.sourceKind==='simconnect'||(this.sourceKind==='replay'&&this.strictReplay);}
  private knownFor:string|null=null;
  private knownMatch:WsgAircraftMatch|null=null;
  private ballastByProfile: Record<string, number> = {};
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private store: ProfileStore,
    private setLvar: (name: string | null) => void,
    private notifyBallast: (profileId: string, f: number) => void,
    private matchWsg?:(container:string|null,span:number|null)=>Promise<WsgAircraftMatch|null>,
    private notifyActive?:(state:CockpitState)=>void,
    kind='simulated',
    private loadWsgVariant?:(key:string)=>Promise<WsgAircraftMatch|null>,
  ) {this.sourceKind=kind;}

  getState = (): CockpitState => this.state;

  async initialize(): Promise<void> {
    this.store.setDemoExamples?.(this.sourceKind==='simulated');
    const settings = await this.store.getSettings();
    this.ballastByProfile = { ...settings.ballast_by_profile };
    await this.refresh();
  }

  async settings(): Promise<Settings> {
    const settings = await this.store.getSettings();
    return { ...settings, ballast_by_profile: { ...this.ballastByProfile } };
  }

  private write(job: () => Promise<void>): Promise<void> {
    const next = this.writes.then(job);
    this.writes = next.catch(() => { /* callers handle failures; allow subsequent writes */ });
    return next;
  }

  flush(): Promise<void> { return this.writes; }

  async updateSettings(settings: Settings): Promise<void> {
    // The main session owns ballast; a renderer's older copy cannot overwrite a panel adjustment.
    await this.write(() => this.store.setSettings({ ...settings, ballast_by_profile: { ...this.ballastByProfile } }));
    this.state={...this.state,autoHideExternal:settings.ui.auto_hide_external};
    await this.refresh();
  }

  async removeLocalProfile(id:string):Promise<void>{
    if(id!==sanitizeId(id)||!id)throw Error('Invalid local profile ID');
    await this.write(async()=>{
      const meta=(await this.store.list()).find(p=>p.id===id);
      if(!meta||meta.virtual)throw Error('Only saved local profiles may be deleted.');
      await this.store.remove(id);
      const settings=await this.settings();forgetLocalProfile(settings,id);delete this.ballastByProfile[id];
      await this.store.setSettings(settings);
    });
    await this.refresh();
  }

  async setBallast(f: number, profileId: string | null = this.state.profile?.id ?? null): Promise<boolean> {
    if (!profileId || this.state.profile?.id !== profileId || !usesManualBallast(this.state.profile) || typeof f !== 'number' || !isFinite(f)) return false;
    const fraction = clamp01(f);
    this.ballastByProfile[profileId] = fraction;
    this.state = { ...this.state, ballast: fraction };
    this.notifyBallast(profileId, fraction);
    await this.write(async () => {
      const settings = await this.settings();
      await this.store.setSettings(settings);
    });
    return true;
  }

  async refresh(): Promise<void> {
    const g = ++this.generation;
    const settings = await this.settings();
    const allMetas = await this.store.list();
    const strict=this.strictSelection();
    const metas=this.sourceKind==='simulated'?allMetas:allMetas.filter(m=>!m.virtual);
    let profile:Profile|null=null;
    let source:CockpitState['profileSource']='none', noProfileMessage:string|undefined,detectedWsgVariant:string|null=null;
    let id:string|null=null;
    const selected=settings.profile_selection;
    const manualWsg=selected.mode==='manual'&&selected.manualId?.startsWith('WSG:');
    const fallbackWsg=selected.mode==='auto'&&selected.fallbackId?.startsWith('WSG:');
    const loadExplicit=async(key:string,manual:boolean)=>{
      if(!this.loadWsgVariant)return null;
      try{
        const match=await this.loadWsgVariant(key);
        const effective=match?wsgFlightProfile(match,settings.wsg_profile_overrides):null;
        if(!effective)return null;
        if(!manual){const validation=validateProfile(effective,{liveHandleCount:this.state.sample?.flapCount});if(!validation.ok){noProfileMessage=validation.errors.find(e=>e.code==='wsg-live-count')?.message??noProfileMessage;return null;}}
        return effective;
      }catch{return null;}
    };
    if(manualWsg){
      profile=await loadExplicit(selected.manualId!.slice(4),true);
      if(g!==this.generation)return;
      if(profile)source='manual';
      else noProfileMessage='Selected WSG profile unavailable. Review Profiles or use a local profile.';
    }else if(strict||settings.profile_selection.mode==='manual'){
      const sample=this.state.sample;
      const mightLookup=strict&&!!(this.binding&&sample?.aircraftContainer&&sample.wingSpanM&&this.matchWsg);
      let choice=resolveProfileChoice(metas,settings,this.title,this.binding,{pending:mightLookup,usableVariantKey:null});
      if(choice.kind==='pending'){
        let match:WsgAircraftMatch|null=null;
        if(this.knownFor===this.binding)match=this.knownMatch;
        else try{match=await this.matchWsg!(sample!.aircraftContainer!,sample!.wingSpanM!);if(g!==this.generation)return;this.knownFor=this.binding;this.knownMatch=match;}catch{/* local fallback remains available */}
        if(g!==this.generation)return;
        detectedWsgVariant=match?.variantKey??null;
        const effective=match?wsgFlightProfile(match,settings.wsg_profile_overrides):null;
        const validation=effective?validateProfile(effective,{liveHandleCount:this.state.sample?.flapCount}):null;
        const usable=effective&&validation?.ok?effective:null;
        choice=resolveProfileChoice(metas,settings,this.title,this.binding,{pending:false,usableVariantKey:usable?.wsg?.variantKey??null});
        if(choice.kind==='wsg'&&usable){profile=usable;source='wsg';}
        else if(match)noProfileMessage=validation?.errors.find(e=>e.code==='wsg-live-count')?.message??'WSG '+match.variantKey+': profile or mapping unavailable. Review Profiles.';
      }
      if('id' in choice){id=choice.id;source=choice.kind;}
      if(!profile&&!id&&fallbackWsg&&this.title){
        profile=await loadExplicit(selected.fallbackId!.slice(4),false);
        if(g!==this.generation)return;
        if(profile)source='fallback';
      }
      if(!profile&&!id&&!noProfileMessage)noProfileMessage=this.title?'No profile for this aircraft. Choose a custom profile in Settings.':'Waiting for MSFS aircraft.';
    }else{id=selectProfileId(metas,settings,this.title);if(id)source='local';
      else if(this.sourceKind==='simulated'){
        profile=cloneProfile(DEMO_EXAMPLES[0]);source='local';
      }
    }
    try { if (id) profile = await this.store.load(id); } catch { /* unavailable */ }
    if (g !== this.generation) return;
    const prior = this.state.profile;
    if (profile && !profile.wsg && prior?.id === profile.id && validateProfile(prior).ok && !validateProfile(profile).ok) profile = prior;
    const ballast = profile ? initialBallast(profile, this.ballastByProfile[profile.id]).f : 0;
    const oldLvar = prior?.current_flap.lvar_name;
    const changed = prior?.id !== profile?.id || this.state.ballast !== ballast;
    this.state = { ...this.state, ready: true, profile,profileSource:profile?source:'none',noProfileMessage:profile?undefined:noProfileMessage,detectedWsgVariant,aircraftTitle:this.title,aircraftBindingKey:this.binding, ballast, units: settings.units, height:settings.height, agl:settings.agl, zoom: settings.ui.zoom,showBallast:settings.ui.show_ballast,showAgl:settings.ui.show_agl,autoHideExternal:settings.ui.auto_hide_external,simpleFlap:settings.ui.simple_flap,showTransitions:settings.ui.show_transitions,groupHiddenFlapLabels:settings.ui.group_hidden_flap_labels,highlightRecommended:settings.ui.highlight_recommended,showWind:settings.ui.show_wind,barShading:settings.ui.bar_shading };
    if (oldLvar !== profile?.current_flap.lvar_name) this.setLvar(profile?.current_flap.lvar_name ?? null);
    if (changed && profile) this.notifyBallast(profile.id, ballast);
    this.notifyActive?.(this.state);
    if (profile && !profile.wsg && metas.some(m=>m.id===profile!.id&&!m.virtual) && settings.last_profile_id !== profile.id) {
      const selectedId = profile.id;
      await this.write(async () => {
        if (g !== this.generation) return;
        const latest = await this.settings();
        // Do not overwrite a newer explicit selection arriving while this profile loaded.
        if (g !== this.generation || latest.last_profile_id !== settings.last_profile_id) return;
        latest.last_profile_id = selectedId;
        await this.store.setSettings(latest);
      });
    }
  }

  setSourceKind(kind:string):void {
    if(this.sourceKind===kind)return;
    this.sourceKind=kind;this.resetSample();
    this.store.setDemoExamples?.(kind==='simulated');
    void this.refresh().catch(()=>{});
  }
  resetSample(): void {
    this.title=null;this.binding=null;this.knownFor=null;this.knownMatch=null;this.strictReplay=false;this.generation++;
    this.state={...this.state,sample:null,receivedAt:0,profile:null,profileSource:'none',ready:false,aircraftTitle:null,aircraftBindingKey:null,detectedWsgVariant:null};
    this.notifyActive?.(this.state);
  }
  sample(sample: SimSample, receivedAt: number): void {
    if(this.sourceKind==='replay'&&sample.aircraftContainer&&sample.wingSpanM)this.strictReplay=true;
    const previousCount=this.state.sample?.flapCount;
    this.state = { ...this.state, sample, receivedAt };
    const title=sample.connected&&sample.aircraftTitle?sample.aircraftTitle:null;
    const binding=title?aircraftBindingKey(title,sample.aircraftContainer,sample.wingSpanM):null;
    if(binding!==this.binding&&(this.strictSelection()||title!==null)){
      this.title=title;this.binding=binding;this.knownFor=null;this.knownMatch=null;
      this.state={...this.state,profile:null,profileSource:'none',ready:false,ballast:0,aircraftTitle:title,aircraftBindingKey:binding,detectedWsgVariant:null,noProfileMessage:title?'Looking up aircraft profile.':'Waiting for MSFS aircraft.'};
      this.notifyActive?.(this.state);
      void this.refresh().catch(()=>{});
    }else if(this.strictSelection()&&this.knownMatch&&previousCount!==sample.flapCount){void this.refresh().catch(()=>{});}
  }
}
