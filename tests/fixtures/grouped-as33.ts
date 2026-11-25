import type {Profile} from '../../core/types';
import type {WsgPublishedProfile} from '../../core/wsg-catalog';
import {wsgFlightProfile} from '../../core/wsg-flight';
import {makeProfile} from '../unit/helpers';

/** Synthetic simulator-only IAS values for testing group/handle identity.
 * They are intentionally not published performance data. */
export const groupedLabels=['L','6','5','N','4','3','2','1'];
export const lightKg=485,heavyKg=600;
export const kphToKt=(kph:number)=>kph/1.852;
const speeds=[85,90,100,115,135,160,190];
const key='AS33-18-FIXTURE';

export function groupedAs33(kind:'native'|'wsg'):Profile{
  if(kind==='native'){
    const p=makeProfile(8,{id:'grouped-native'});
    p.flaps=groupedLabels.map((label,i)=>({label,handle_index:7-i}));
    p.weight_kg={light:lightKg,heavy:heavyKg};
    p.vs_min={no_ballast_kt:kphToKt(65),max_ballast_kt:kphToKt(75)};
    p.vne=kphToKt(280);
    p.transitions=speeds.map((v,i)=>({no_ballast_kt:kphToKt(v),max_ballast_kt:kphToKt(v*1.1),...(i<2?{exclude_from_display:true}:{})}));
    return p;
  }
  const published:WsgPublishedProfile={
    variantKey:key,lightWeightKg:lightKg,heavyWeightKg:heavyKg,lightStallIasKph:null,heavyStallIasKph:null,
    bands:groupedLabels.map((label,i)=>({label,handleIndex:7-i,lightStartKt:i?kphToKt(speeds[i-1]):0,heavyStartKt:i?kphToKt(speeds[i-1]*1.1):0,excludeFromDisplay:i===1||i===2}))
  };
  const p=wsgFlightProfile({variantKey:key,displayName:'Synthetic grouped AS33',profile:published,visualVneTasKph:282},{});
  if(!p)throw Error('Invalid synthetic WSG profile');return p;
}

export function groupedCases(p:Profile){
  const n=p.transitions[2].no_ballast_kt!,four=p.transitions[3].no_ballast_kt!;
  const group=p.wsg?'L–6–5':'L-6-5';
  return [
    {name:'102 km/h, actual 5',ias:kphToKt(102),index:5,actual:'5',group,rec:'N',direction:'faster'},
    {name:'just below 5 -> N',ias:n-.01,index:5,actual:'5',group,rec:null,direction:null},
    {name:'exact 5 -> N boundary',ias:n,index:5,actual:'5',group,rec:'N',direction:'faster'},
    {name:'just below N -> 4',ias:four-.01,index:5,actual:'5',group,rec:'N',direction:'faster'},
    {name:'exact N -> 4 boundary',ias:four,index:5,actual:'5',group,rec:'4',direction:'faster'},
    {name:'N -> merged slower group',ias:n-.01,index:4,actual:'N',group:'N',rec:group,direction:'slower'},
    {name:'already in recommended N band',ias:kphToKt(102),index:4,actual:'N',group:'N',rec:null,direction:null},
    {name:'physical L remains exact',ias:kphToKt(102),index:7,actual:'L',group,rec:'N',direction:'faster'},
    {name:'physical 6 remains exact',ias:kphToKt(102),index:6,actual:'6',group,rec:'N',direction:'faster'},
  ] as const;
}
