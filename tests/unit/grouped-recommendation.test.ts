import {describe,expect,it} from 'vitest';
import {groupedAs33,groupedCases,lightKg} from '../fixtures/grouped-as33';
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
    const m=buildDisplayModel({profile:p,validation,sample:s,link:'live',manualBallast:0,ias:c.ias,flap:new CurrentFlapResolver().resolve(p,s,1000)});
    expect(m.simple.current,c.name).toBe(c.actual);
    expect(m.cells[m.currentRow!]?.label,c.name).toBe(c.group);
    if(c.group!==c.actual)expect(m.badge,c.name).toEqual({kind:'mapped',text:c.actual});
    expect(m.simple.suggestion,c.name).toEqual(c.rec===null?null:{label:c.rec,direction:c.direction});
    expect(m.recommendedRow===null?null:m.cells[m.recommendedRow]?.label,c.name).toBe(c.rec);
   }
  });
 }
});
