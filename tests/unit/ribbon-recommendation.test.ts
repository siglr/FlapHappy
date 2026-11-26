import {describe,it,expect} from 'vitest';
import {buildDisplayModel} from '../../core/display-model';
import {CurrentFlapResolver} from '../../core/flapmap';
import {validateProfile} from '../../core/validate';
import {defaultSettings,normalizeSettings} from '../../core/settings';
import {makeProfile,sample} from './helpers';
describe('optional ribbon recommendation',()=>{
 it('uses raw live IAS, recommends the first band at nonnegative low IAS, excludes same-band, unavailable, ground and high offscale',()=>{
 const p=makeProfile(6);
 const m=(iasKt:number,other:Record<string,unknown>={},link:'live'|'nodata'='live')=>{
 const s=sample({flapCount:6,flapIndex:2,iasKt,...other});
 return buildDisplayModel({profile:p,validation:validateProfile(p),sample:s,link,manualBallast:0,ias:70,flap:new CurrentFlapResolver().resolve(p,s,0)});
 };
 expect(m(95).recommendedRow).toBe(4);expect(m(55).recommendedRow).toBe(1);expect(m(70).recommendedRow).toBeNull();
 expect(m(95,{onGround:true}).recommendedRow).toBeNull();expect(m(95,{},'nodata').recommendedRow).toBeNull();
 expect(m(20).recommendedRow).toBe(0);expect(m(0).recommendedRow).toBe(0);expect(m(-1).recommendedRow).toBeNull();expect(m(0,{iasKt:null}).recommendedRow).toBeNull();expect(m(400).recommendedRow).toBeNull();
 expect(defaultSettings().ui.highlight_recommended).toBe(false);
 const settings=defaultSettings();settings.ui.highlight_recommended=true;expect(normalizeSettings(settings).ui.highlight_recommended).toBe(true);
 });
});
