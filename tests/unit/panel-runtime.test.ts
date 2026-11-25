import { describe, expect, it, vi } from 'vitest';
import { PanelRuntime } from '../../app-electron/panel-runtime';
import { parseCli } from '../../app-electron/cli';
import { MemoryProfileStore } from '../../adapters/simulated/memory-store';
import { defaultSettings, normalizeSettings } from '../../core/settings';
import { makeProfile, sample } from './helpers';

describe('main-process panel session', () => {
  it('keeps the main window mandatory and defaults the external-on-launch preference off', () => {
    expect(parseCli([])).toMatchObject({ quit: false });
    expect(parseCli(['--panel-only', '--source=replay'])).not.toHaveProperty('panelOnly');
    expect(parseCli(['--quit'])).toMatchObject({ quit: true });
    expect(defaultSettings().ui.external_panel_on_launch).toBe(false);
    expect(normalizeSettings({ schema: 'flaphappy.settings/1' }).ui.external_panel_on_launch).toBe(false);
    expect(normalizeSettings({ schema: 'flaphappy.settings/1', ui: { external_panel_on_launch: true } }).ui.external_panel_on_launch).toBe(true);
  });

  it('uses saved profiles and telemetry without a renderer, with preserved manual ballast', async () => {
    const p = makeProfile(2, { id: 'fixture' });
    p.weight_kg={light:null,heavy:null};
    const next = makeProfile(3, { id: 'next' });
    next.weight_kg={light:null,heavy:null};
    next.current_flap = { source: 'lvar', lvar_name: 'Flap test', manual_fallback: false };
    const store = new MemoryProfileStore([p, next]);
    const settings = await store.getSettings();
    settings.last_profile_id = p.id;
    settings.active_by_title['first'] = p.id;
    settings.active_by_title['second'] = next.id;
    settings.ballast_by_profile[p.id] = 0.25;
    await store.setSettings(settings);
    const setLvar = vi.fn();
    const notify = vi.fn();
    const runtime = new PanelRuntime(store, setLvar, notify);
    await runtime.initialize();
    expect(runtime.getState()).toMatchObject({ ready: true, profile: { id: p.id }, ballast: 0.25 });
    runtime.sample(sample({ aircraftTitle: 'first' }), 1200);
    await runtime.refresh();
    expect(runtime.getState()).toMatchObject({ sample: { iasKt: 70 }, receivedAt: 1200, profile: { id: p.id } });
    const staleDesktopSettings = await runtime.settings();
    await Promise.all([
      runtime.setBallast(0.5),
      runtime.updateSettings({ ...staleDesktopSettings, units: 'kmh' }),
      runtime.setBallast(0.75, p.id),
    ]);
    expect(runtime.getState()).toMatchObject({ units: 'kmh', ballast: 0.75 });
    expect((await store.getSettings()).ballast_by_profile[p.id]).toBe(0.75);
    expect(notify).toHaveBeenCalledWith(p.id, 0.75);
    expect(await runtime.setBallast(0.15, 'other')).toBe(false);
    runtime.sample(sample({ aircraftTitle: 'second' }), 1300);
    expect(runtime.getState().ready).toBe(false);
    await runtime.refresh();
    expect(runtime.getState()).toMatchObject({ profile: { id: next.id }, receivedAt: 1300, ballast: next.ballast.default_fraction });
    expect(setLvar).toHaveBeenCalledWith('Flap test');
    const changedSettings=await runtime.settings();
    changedSettings.height='m';changedSettings.agl={bottom_m:10,top_m:500,low_m:100,high_m:300};
    changedSettings.ui.show_agl=false;changedSettings.ui.show_wind=false;changedSettings.ui.show_transitions=true;changedSettings.ui.bar_shading=false;
    await runtime.updateSettings(changedSettings);
    runtime.sample(sample({aircraftTitle:'second',aglFt:600,windKt:17}),1400);
    expect(runtime.getState()).toMatchObject({height:'m',agl:changedSettings.agl,showAgl:false,showWind:false,showTransitions:true,barShading:false,sample:{aglFt:600,windKt:17}});
    expect((await runtime.settings()).last_profile_id).toBe(next.id);
    expect((await runtime.settings()).ballast_by_profile[p.id]).toBe(0.75);
  });

  it('seeds only missing built-in profiles on first run', async () => {
    const store = new MemoryProfileStore();
    const runtime = new PanelRuntime(store, () => {}, () => {});
    await runtime.initialize();
    expect((await store.list()).map(p => p.id).sort()).toEqual(['as33-15m','as33-18m','js3']);
    expect(runtime.getState()).toMatchObject({ ready: true, profile: { id: 'as33-18m' }, sample: null });
    const original = await store.load('as33-18m');
    original.notes = 'existing fixture';
    await store.save(original);
    await runtime.initialize();
    expect((await store.load('as33-18m')).notes).toBe('existing fixture');
  });
  it('owns strict live matching and local WSG override/reset for both hosts, rejecting stale match results',async()=>{
    const local=makeProfile(2,{id:'local'});const store=new MemoryProfileStore([local]);const settings=await store.getSettings();settings.last_profile_id=local.id;settings.wsg_profiles_enabled=true;await store.setSettings(settings);
    const published={variantKey:'WSG-TEST',lightWeightKg:400,heavyWeightKg:600,lightStallIasKph:null,heavyStallIasKph:null,bands:[{label:'L',handleIndex:2,lightStartKt:0,heavyStartKt:0,excludeFromDisplay:false},{label:'N',handleIndex:1,lightStartKt:50,heavyStartKt:60,excludeFromDisplay:true},{label:'1',handleIndex:0,lightStartKt:70,heavyStartKt:80,excludeFromDisplay:false}]};
    const match={variantKey:published.variantKey,displayName:'Test',profile:published,visualVneTasKph:250};
    let release:(v:typeof match)=>void=()=>{};
    const resolver=vi.fn(async(c:string|null)=>c==='stale_model'?new Promise<typeof match>(r=>{release=r;}):c==='exact_model'?match:null);
    const runtime=new PanelRuntime(store,()=>{},()=>{},resolver,undefined,'simconnect');await runtime.initialize();expect(runtime.getState().profile).toBeNull();
    runtime.sample(sample({aircraftTitle:'Old',aircraftContainer:'stale_model',wingSpanM:18,flapCount:3}),2000);
    await vi.waitFor(()=>expect(resolver).toHaveBeenCalledWith('stale_model',18));
    runtime.sample(sample({aircraftTitle:'Unknown',aircraftContainer:'unknown_model',wingSpanM:18,flapCount:3}),2100);
    await vi.waitFor(()=>expect(runtime.getState().ready).toBe(true));release(match);await new Promise(r=>setTimeout(r,0));expect(runtime.getState().profile).toBeNull();
    runtime.sample(sample({aircraftTitle:'Matched',aircraftContainer:'exact_model',wingSpanM:18,flapCount:3}),2200);
    await vi.waitFor(()=>expect(runtime.getState().profileSource).toBe('wsg'));expect(runtime.getState().profile?.wsg?.hiddenTransitions).toEqual([true,false]);expect(runtime.getState().profile?.vne).toBeNull();
    expect(await runtime.setBallast(.8)).toBe(false);
    const custom=await runtime.settings();custom.wsg_profile_overrides={'WSG-TEST':{mapping:JSON.stringify([[2,'L'],[1,'N'],[0,'1']]),ballastMode:'manual'}};await runtime.updateSettings(custom);
    expect(runtime.getState().profile?.wsg?.ballastMode).toBe('manual');expect(runtime.getState().profile?.weight_kg).toEqual({light:400,heavy:600});expect(await runtime.setBallast(.5)).toBe(true);
    const reset=await runtime.settings();reset.wsg_profile_overrides={};await runtime.updateSettings(reset);expect(runtime.getState().profile?.wsg?.ballastMode).toBe('live');expect(await runtime.setBallast(.9)).toBe(false);
    runtime.sample(sample({aircraftTitle:'Another',aircraftContainer:'unknown_model',wingSpanM:18,flapCount:3}),2300);await vi.waitFor(()=>expect(runtime.getState().ready).toBe(true));expect(runtime.getState().profile).toBeNull();
  });
});
