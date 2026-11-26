import {expect,it} from 'vitest';
import {parseCli} from '../../app-electron/cli';
import {PanelRuntime} from '../../app-electron/panel-runtime';
import {MemoryProfileStore} from '../../adapters/simulated/memory-store';
import {defaultSettings,normalizeSettings} from '../../core/settings';
import {formatIas,formatSpeedField,formatWind,formatWeightField,weightToKilograms,kilogramsToWeight,unitToKnots,knotsToUnit} from '../../core/units';

it('parses opt-in unit flags independently, ignores malformed values, and keeps legacy CLI behavior',()=>{
 expect(parseCli([]).displayUnits).toEqual({});
 expect(parseCli(['--source=simulated','--airspeed-unit=mph','--weight-unit','lb','--altitude-unit=m','--wind-unit=mps']).displayUnits).toEqual({units:'mph',weight_unit:'lb',height:'m',wind_unit:'mps'});
 expect(parseCli(['--airspeed-unit=unknown','--weight-unit=ft','--altitude-unit','wrong','--wind-unit=kg']).displayUnits).toEqual({});
 expect(parseCli(['--airspeed-unit=kmh','--weight-unit=kg','--altitude-unit=ft','--wind-unit=kt']).displayUnits).toEqual({units:'kmh',weight_unit:'kg',height:'ft',wind_unit:'kt'});
 expect(parseCli(['--speed=4','--airspeed-unit=kt']).speed).toBe(4);
});
it('normalizes independently without changing older standalone defaults or canonical units',()=>{
 const old=normalizeSettings({schema:'flaphappy.settings/1',units:'kmh'});
 expect(old).toMatchObject({units:'kmh',height:'m',weight_unit:'kg',wind_unit:'auto'});
 expect(normalizeSettings({...old,units:'mph',weight_unit:'lb',wind_unit:'mps'})).toMatchObject({units:'mph',weight_unit:'lb',wind_unit:'mps'});
 expect(normalizeSettings({...old,weight_unit:'bad',wind_unit:'bad'})).toMatchObject({weight_unit:'kg',wind_unit:'auto'});
 expect(formatIas(100,'mph')).toBe('115 mph');expect(formatSpeedField(100,'mph')).toBe('115.1');
 expect(unitToKnots(knotsToUnit(73.234567,'mph'),'mph')).toBeCloseTo(73.234567,12);
 expect(formatWind(20,'mps','mph')).toBe('10.3 m/s');expect(formatWind(20,'kt','kmh')).toBe('20 kt');expect(formatWind(20,'auto','kmh')).toBe('37 km/h');expect(formatWind(null,'mps','mph')).toBe('--- m/s');
 expect(formatWeightField(475,'lb')).toBe('1047.2');expect(weightToKilograms(kilogramsToWeight(475.234567,'lb'),'lb')).toBeCloseTo(475.234567,12);
});
it('runtime handoff overlays live feed without writing standalone choices, including subsequent partial launches',async()=>{
 const store=new MemoryProfileStore();const saved=defaultSettings();saved.units='kmh';saved.height='ft';saved.weight_unit='kg';saved.wind_unit='auto';await store.setSettings(saved);
 const runtime=new PanelRuntime(store,()=>{},()=>{},undefined,undefined,'simulated',undefined,{units:'mph',height:'m',weight_unit:'lb',wind_unit:'mps'});
 await runtime.initialize();expect(runtime.getState()).toMatchObject({units:'mph',height:'m',weightUnit:'lb',windUnit:'mps'});
 const changed=await runtime.settings();changed.ui.show_agl=false;await runtime.updateSettings(changed);expect(await store.getSettings()).toMatchObject({units:'kmh',height:'ft',weight_unit:'kg',wind_unit:'auto',ui:{show_agl:false}});
 await runtime.setLaunchUnits({wind_unit:'kt'});expect(runtime.getState()).toMatchObject({units:'mph',height:'m',weightUnit:'lb',windUnit:'kt'});
 await runtime.setLaunchUnits({});expect(runtime.getState().windUnit).toBe('kt');
 const standalone=new PanelRuntime(store,()=>{},()=>{});await standalone.initialize();expect(standalone.getState()).toMatchObject({units:'kmh',height:'ft',weightUnit:'kg',windUnit:'auto'});
});
