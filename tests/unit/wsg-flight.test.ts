import {describe,it,expect} from 'vitest';
import {wsgFlightProfile,wsgGroups,wsgBoundaries} from '../../core/wsg-flight';
import {mappingIdentity,transitionIdentity,resetWsgOverrides,wsgStallContext} from '../../core/wsg-overrides';
import {buildDisplayModel} from '../../core/display-model';
import {CurrentFlapResolver} from '../../core/flapmap';
import {validateProfile} from '../../core/validate';
import {parseWsgCatalog} from '../../core/wsg-catalog';
import {usesManualBallast} from '../../core/weight';
import {sample} from './helpers';
// Representative AS33-18-GF public catalog revision 16, rounded here for fixtures.
const labels=['L','6','5','N','4','3','2','1'];
const light=[0,41.579,46.438,51.298,59.404,69.648,84.227,96.648];
const heavy=[0,46.438,52.367,57.771,68.035,78.842,93.946,106.367];
const base=parseWsgCatalog({schema:'wsg.flaphappy.catalog/2',revision:16,profiles:[{schema:'wsg.flaphappy.profile/1',variantKey:'AS33-18-GF',handleCount:8,lightWeightKg:485,heavyWeightKg:600,bands:labels.map((label,i)=>({label,handleIndex:7-i,lightStartKt:light[i],heavyStartKt:heavy[i],excludeFromDisplay:i===1||i===2}))}]}).profiles[0];
const match={variantKey:base.variantKey,displayName:'AS33 18m',profile:base,visualVneTasKph:282};
const model=(p:NonNullable<ReturnType<typeof wsgFlightProfile>>,iasKt:number,kg:number|null,flapIndex:number|null,link:'live'|'nodata'='live',manualBallast=0,flapCount=8)=>{
 const s=sample({iasKt,totalWeightKg:kg,flapCount,flapIndex});
 return buildDisplayModel({profile:p,validation:validateProfile(p,{liveHandleCount:flapCount}),sample:s,link,ias:iasKt,manualBallast,flap:new CurrentFlapResolver().resolve(p,s,1000)});
};
describe('WSG flight display',()=>{
 it('keeps exact native handles and merged groups with no Vs or IAS maximum; visual edge never generates FAST/LOW',()=>{
  const p=wsgFlightProfile(match,{})!;expect(p.vne).toBeNull();expect(p.vs_min.no_ballast_kt).toBeNull();expect(p.flaps).toHaveLength(8);
  expect(wsgGroups(p).labels).toEqual(['L–6–5','N','4','3','2','1']);
  const m=model(p,200,485,6);expect(m.barVisible).toBe(true);expect(m.boundaries?.slice(1)).toEqual([...light.slice(3),282/1.852]);expect(m.boundaries?.[0]).toBeCloseTo(51.298-(10.244+12.421)/2);expect(m.marker.pos).toBe(1);expect(m.alert).toBeNull();expect(m.cells[0].state).toBe('current');expect(m.badge).toEqual({kind:'mapped',text:'6'});expect(m.simple).toEqual({current:'6',suggestion:{label:'1',direction:'faster'}});expect(model(p,45,485,6).simple).toEqual({current:'6',suggestion:null});
  const low=model(p,30,600,7);expect(low.alert).toBeNull();expect(low.boundaries?.slice(1,-1)).toEqual(heavy.slice(3));expect(model(p,30,600,4).simple.suggestion).toEqual({label:m.cells[0].label,direction:'slower'});
  expect(model(p,155,485,6).simple.suggestion).toEqual({label:'1',direction:'faster'});
  expect(model(p,70,542.5,2).boundaries?.[1]).toBeCloseTo((light[3]+heavy[3])/2);
  expect(model(p,70,300,2).boundaries).toEqual(wsgBoundaries(p,0));expect(model(p,70,800,2).boundaries).toEqual(wsgBoundaries(p,1));
  expect(model(p,70,null,2).barVisible).toBe(false);expect(model(p,70,500,2,'nodata').currentRow).toBeNull();
  expect(model(p,70,500,null).currentRow).toBeNull();expect(model(p,70,500,2,'live',0,7).barVisible).toBe(false);
 });
 it('uses explicit IAS limits and local manual ballast, preserves weights and resets to inherited defaults',()=>{
  const key=transitionIdentity(base.bands[4],base.bands[5]);
  const all={[base.variantKey]:{mapping:mappingIdentity(base),ballastMode:'manual' as const,stallContext:wsgStallContext(base)!,lightStallIasKph:75,heavyStallIasKph:85,upperIasKph:240,transitions:{[key]:{excludeFromDisplay:true}}}};
  const p=wsgFlightProfile(match,all)!;expect(usesManualBallast(p)).toBe(true);expect(p.weight_kg).toEqual({light:485,heavy:600});
  expect(wsgGroups(p).labels).toEqual(['L–6–5','N','4–3','2','1']);
  const m=model(p,35,null,2,'live',1);expect(m.alert).toBe('LOW');expect(m.currentRow).toBe(2);expect(m.badge?.text).toBe('3');
  expect(model(p,160,485,2,'live',0).alert).toBe('FAST');
  const reset=wsgFlightProfile(match,resetWsgOverrides(all,base.variantKey))!;expect(usesManualBallast(reset)).toBe(false);expect(reset.vne).toBeNull();expect(reset.vs_min.no_ballast_kt).toBeNull();
 });
 it('uses the landing detent even when visibility changes; suppresses data for changed weights or old detent context',()=>{
  const published={...base,lightStallIasKph:75,heavyStallIasKph:85};
  const ref={...match,profile:published}; const id=transitionIdentity(published.bands[1],published.bands[2]);
  const changed={mapping:mappingIdentity(published),transitions:{[id]:{excludeFromDisplay:false}}};
  const record={[published.variantKey]:changed};
  expect(wsgFlightProfile(ref,record)?.vs_min.no_ballast_kt).toBeCloseTo(75/1.852);
  expect(wsgFlightProfile(ref,resetWsgOverrides(record,published.variantKey))?.vs_min.no_ballast_kt).toBeCloseTo(75/1.852);
  const legacy={...changed,stallContext:JSON.stringify([485,600,5,'5']),lightStallIasKph:70,heavyStallIasKph:80};
  expect(wsgFlightProfile(ref,{[published.variantKey]:legacy})?.vs_min.no_ballast_kt).toBeCloseTo(75/1.852);
  const provided={...legacy,stallContext:wsgStallContext(published,changed)!};
  expect(wsgFlightProfile(ref,{[published.variantKey]:provided})?.vs_min.no_ballast_kt).toBeCloseTo(70/1.852);
  const allTransitions=Object.fromEntries(published.bands.slice(1).map((b,i)=>[transitionIdentity(published.bands[i],b),{lightStartKt:b.lightStartKt,heavyStartKt:b.heavyStartKt}]));
  expect(wsgFlightProfile(ref,{[published.variantKey]:{mapping:mappingIdentity(published),lightWeightKg:490,transitions:allTransitions}})?.vs_min.no_ballast_kt).toBeNull();
 });
});
