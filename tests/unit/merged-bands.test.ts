import {defaultSettings,normalizeSettings} from '../../core/settings';
import {describe,it,expect} from 'vitest';
import {makeProfile,sample} from './helpers';
import {exportProfileJson,parseProfileJson} from '../../core/profile';
import {effectiveBoundaries,flapGroups} from '../../core/scale';
import {validateProfile} from '../../core/validate';
import {buildDisplayModel} from '../../core/display-model';
import {CurrentFlapResolver} from '../../core/flapmap';
describe('adjacent excluded transitions',()=>{
 it('merges consecutive rows, preserves exact handle, omits blank hidden boundaries and round trips',()=>{
  const p=makeProfile(8);p.flaps.forEach((r,i)=>r.label=['L','6','5','N','4','3','2','1'][i]);
  for(const i of [0,1,4])p.transitions[i]={no_ballast_kt:null,max_ballast_kt:null,exclude_from_display:true};
  expect(flapGroups(p).labels).toEqual(['L-6-5','N','4-3','2','1']);
  expect(validateProfile(p).ok).toBe(true);
  expect(effectiveBoundaries(p,0)).toEqual([40,76,88,112,124,p.vne]);
  const s=sample({flapIndex:1,flapCount:8});
  const m=buildDisplayModel({groupHiddenFlapLabels:true,profile:p,validation:validateProfile(p),sample:s,link:'live',manualBallast:0,ias:80,flap:new CurrentFlapResolver().resolve(p,s,1000)});
  expect(m.cells.map(c=>c.label)).toEqual(['L-6-5','N','4-3','2','1']);expect(m.currentRow).toBe(0);expect(m.badge).toEqual({kind:'mapped',text:'6'});
  const legacy=buildDisplayModel({profile:p,validation:validateProfile(p),sample:s,link:'live',manualBallast:0,ias:80,flap:new CurrentFlapResolver().resolve(p,s,1000)});
  expect(legacy.cells.map(c=>c.label)).toEqual(['5','N','3','2','1']);expect(legacy.currentRow).toBe(m.currentRow);expect(legacy.boundaries).toEqual(m.boundaries);expect(legacy.badge).toEqual(m.badge);
  const round=parseProfileJson(exportProfileJson(p)).profile!;expect(round.transitions[1].exclude_from_display).toBe(true);expect(round.transitions[1].no_ballast_kt).toBeNull();
  round.transitions[1].exclude_from_display=false;expect(validateProfile(round).ok).toBe(false);
 });
 it('every divider excluded still yields one band with the existing two bounds',()=>{
 const p=makeProfile(3);p.transitions.forEach(t=>t.exclude_from_display=true);
 expect(flapGroups(p).labels).toEqual(['1-2-3']);expect(effectiveBoundaries(p,0)).toEqual([40,p.vne]);
 });
});

it('default off for old settings and explicit choice survives normalization',()=>{
 const settings=defaultSettings();expect(settings.ui.group_hidden_flap_labels).toBe(false);
 const old=JSON.parse(JSON.stringify(settings));delete old.ui.group_hidden_flap_labels;
 expect(normalizeSettings(old).ui.group_hidden_flap_labels).toBe(false);
 settings.ui.group_hidden_flap_labels=true;expect(normalizeSettings(JSON.parse(JSON.stringify(settings))).ui.group_hidden_flap_labels).toBe(true);
 settings.ui.group_hidden_flap_labels=false;expect(normalizeSettings(JSON.parse(JSON.stringify(settings))).ui.group_hidden_flap_labels).toBe(false);
});
