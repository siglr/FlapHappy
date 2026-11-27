import {describe,expect,it} from 'vitest';
import {groupedAs33,groupedCases,lightKg,lowerBoundCases} from '../fixtures/grouped-as33';
import {sample} from './helpers';
import {buildDisplayModel} from '../../core/display-model';
import {CurrentFlapResolver} from '../../core/flapmap';
import {validateProfile} from '../../core/validate';

describe('grouped AS33 recommendation uses display groups, not raw flap-row indexes',()=>{
 for(const kind of ['native','wsg'] as const){
  it(kind+' maps exact physical handle to its merged band and recommends the correct adjacent band',()=>{
   const p=groupedAs33(kind);
   const validation=validateProfile(p,{liveHandleCount:8});expect(validation.ok).toBe(true);
   for(const c of groupedCases(p)){
    const s=sample({flapCount:8,flapIndex:c.index,iasKt:c.ias,totalWeightKg:lightKg});
    const m=buildDisplayModel({groupHiddenFlapLabels:true,profile:p,validation,sample:s,link:'live',manualBallast:0,ias:c.ias,flap:new CurrentFlapResolver().resolve(p,s,1000)});
    expect(m.simple.current,c.name).toBe(c.actual);
    expect(m.cells[m.currentRow!]?.label,c.name).toBe(c.group);
    if(c.group!==c.actual)expect(m.badge,c.name).toEqual({kind:'mapped',text:c.actual});
    expect(m.simple.suggestion,c.name).toEqual(c.rec===null?null:{label:c.rec,direction:c.direction});
    expect(m.recommendedRow===null?null:m.cells[m.recommendedRow]?.label,c.name).toBe(c.rec);
   }
  });
 }
});


describe('low IAS remains independent of flap recommendations',()=>{
 for(const kind of ['native','wsg'] as const)for(const stall of [true,false])for(const group of [true,false]){
  it(`${kind} with ${stall?'true stall':'visual floor'}, labels ${group} recommends slowest group below/at/above`,()=>{
   const {p,floor}=lowerBoundCases(kind,stall);
   const model=(ias:number,index:number,over:Partial<ReturnType<typeof sample>>={},link:'live'|'nodata'='live')=>{
    const s=sample({flapCount:8,flapIndex:index,iasKt:ias,totalWeightKg:lightKg,...over});
    const validation=validateProfile(p,{liveHandleCount:s.flapCount});
    return buildDisplayModel({groupHiddenFlapLabels:group,profile:p,validation,sample:s,link,manualBallast:0,ias,flap:new CurrentFlapResolver().resolve(p,s,1000)});
   };
   for(const delta of [-0.1,0,0.1]){
    const m=model(floor+delta,3);
    expect(m.boundaries![0]).toBeCloseTo(floor,8);
    expect(m.simple.current).toBe('4');
    expect(m.simple.suggestion).toEqual({label:group?(kind==='wsg'?'L\u20136\u20135':'L-6-5'):'5',direction:'slower'});
    expect(m.recommendedRow).toBe(0);
    expect(m.alert).toBe(stall&&delta<0?'LOW':null);
    if(delta<0){expect(m.marker.pos).toBe(0);expect(m.marker.region).toBe('below');}
    const same=model(floor+delta,5);expect(same.recommendedRow).toBeNull();expect(same.simple.suggestion).toBeNull();
   }
   expect(model(floor-0.1,3,{onGround:true}).recommendedRow).toBeNull();
   expect(model(floor-0.1,3,{},'nodata').recommendedRow).toBeNull();
   for(const speed of [25,24.5,19,0]){
    const low=model(speed,3);expect(low.recommendedRow).toBe(0);
    expect(low.simple.suggestion?.label).toBe(group?(kind==='wsg'?'L\u20136\u20135':'L-6-5'):'5');
    expect(low.simple.suggestion?.direction).toBe('slower');
    expect(model(speed,5).recommendedRow).toBeNull();
    if(speed<25)expect(low.marker.greyed).toBe(true);
    expect(model(speed,3,{onGround:true}).simple.suggestion).toBeNull();
   }
   expect(model(-1,3).recommendedRow).toBeNull();
   expect(model(0,3,{iasKt:null}).recommendedRow).toBeNull();
   expect(model(0,3,{iasKt:NaN}).recommendedRow).toBeNull();
   expect(model(0,3,{},'nodata').recommendedRow).toBeNull();
   if(kind==='wsg')expect(model(floor-0.1,3,{flapCount:6}).recommendedRow).toBeNull();
  });
 }
});
