import type { Profile, ValidationResult } from './types';
import type { WsgAircraftMatch } from './wsg-reference';
import { resolveWsgOverrides, type WsgOverrideMap } from './wsg-overrides';
import { createBlankProfile } from './profile';
import { effectiveSpeed } from './scale';

/** A runtime-only adapter. The catalog's TAS number is visual geometry only;
 * it is never assigned to the standalone profile's IAS limit. */
export function wsgFlightProfile(match:WsgAircraftMatch, overrides:WsgOverrideMap):Profile|null {
  if(!match.profile||match.profile.variantKey!==match.variantKey)return null;
  const resolved=resolveWsgOverrides(match.profile,overrides);
  if(resolved.state!=='ok')return null;
  const p=resolved.profile;
  const runtime=createBlankProfile('WSG:'+p.variantKey);
  runtime.flaps=p.bands.map(b=>({label:b.label,handle_index:b.handleIndex}));runtime.handle_count=p.bands.length;
  runtime.transitions=p.bands.slice(1).map(b=>({no_ballast_kt:b.lightStartKt,max_ballast_kt:b.heavyStartKt}));
  runtime.weight_kg={light:p.lightWeightKg,heavy:p.heavyWeightKg};
  runtime.vs_min={no_ballast_kt:p.lightStallIasKph===null?null:p.lightStallIasKph/1.852,max_ballast_kt:p.heavyStallIasKph===null?null:p.heavyStallIasKph/1.852};
  const max=overrides[p.variantKey]?.upperIasKph;
  runtime.vne=max===undefined?null:max/1.852;
  runtime.wsg={variantKey:p.variantKey,hiddenTransitions:p.bands.slice(1).map(b=>b.excludeFromDisplay),visualMaxKt:match.visualVneTasKph?match.visualVneTasKph/1.852:null,ballastMode:resolved.ballastMode};
  return validateWsgFlight(runtime).ok?runtime:null;
}

export function wsgGroups(p:Profile):{labels:string[];members:number[][];boundaryIndexes:number[]} {
  const members:number[][]=[],boundaryIndexes:number[]=[];
  p.flaps.forEach((_b,i)=>{if(i===0||!p.wsg?.hiddenTransitions[i-1]){members.push([]);if(i)boundaryIndexes.push(i-1);}members[members.length-1].push(i);});
  return {members,boundaryIndexes,labels:members.map(m=>m.map(i=>p.flaps[i].label).join('–'))};
}

/** An optional stall or actual IAS upper limit may produce a warning. A
 * missing limit contributes visual geometry only, never a warning. */
export function wsgBoundaries(p:Profile,f:number):number[]|null {
  if(!p.wsg)return null;
  const groups=wsgGroups(p);
  const visible=groups.boundaryIndexes.map(i=>effectiveSpeed(p.transitions[i],f));
  if(visible.some(x=>x===null||!isFinite(x)||x<=0))return null;
  const v=visible as number[];
  const stall=effectiveSpeed(p.vs_min,f), lo=stall??0;
  const last=v[v.length-1]??lo;
  const gaps=v.slice(1).map((x,i)=>x-v[i]).filter(x=>x>0).sort((a,b)=>a-b);
  const gap=gaps.length?gaps[Math.floor(gaps.length/2)]:Math.max(10,(last-lo)*0.2);
  const hi=p.vne??Math.max(p.wsg.visualMaxKt??0,last+gap);
  const out=[lo,...v,hi];
  return out.every((x,i)=>isFinite(x)&&x>=0&&(i===0||x>out[i-1]))?out:null;
}
export function validateWsgFlight(p:Profile,liveCount?:number|null):ValidationResult {
  const issues:ValidationResult['issues']=[];
  const fail=(category:'structure'|'speeds'|'other',code:string,message:string)=>issues.push({level:'error',category,code,message});
  const n=p.flaps.length;
  if(!p.wsg||n<2||p.handle_count!==n||p.wsg.hiddenTransitions.length!==n-1||p.transitions.length!==n-1||new Set(p.flaps.map(f=>f.handle_index)).size!==n||p.flaps.some(f=>!f.label||f.handle_index===null||!Number.isInteger(f.handle_index)||f.handle_index<0||f.handle_index>=n))fail('structure','wsg-mapping','Invalid WSG native mapping');
  if(liveCount!=null&&liveCount!==n)fail('structure','wsg-live-count','Simulator flap positions do not match this WSG variant');
  const weight=p.weight_kg;if(weight.light==null||weight.heavy==null||!isFinite(weight.light)||!isFinite(weight.heavy)||weight.light<=0||weight.heavy<=weight.light)fail('other','wsg-weights','Invalid WSG reference weights');
  const stall=p.vs_min;if((stall.no_ballast_kt===null)!==(stall.max_ballast_kt===null)||[stall.no_ballast_kt,stall.max_ballast_kt].some(x=>x!==null&&(!isFinite(x)||x<=0)))fail('speeds','wsg-stall','Invalid optional stall IAS pair');
  for(const field of ['no_ballast_kt','max_ballast_kt'] as const){let prev=0;for(const t of p.transitions){const x=t[field];if(x===null||!isFinite(x)||x<=prev){fail('speeds','wsg-triggers','Unordered or missing WSG IAS trigger');break;}prev=x;}}
  if(!issues.length&&(!wsgBoundaries(p,0)||!wsgBoundaries(p,1)))fail('speeds','wsg-bounds','Invalid visible IAS range');
  return {ok:issues.length===0,structureOk:!issues.some(i=>i.category==='structure'),issues,errors:issues,warnings:[]};
}
