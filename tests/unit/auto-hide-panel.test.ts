import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {defaultSettings,normalizeSettings} from '../../core/settings';
const script=readFileSync('panel/flaphappy-ingamepanel/html_ui/InGamePanels/FlapHappy/FlapHappy.js','utf8');
function harness(){
 let camera:unknown=2,ready=true,failCamera=false,ctor:any;
 const classes=new Set<string>(),events=new Map<string,()=>void>(),timers=new Map<number,{fn:()=>void,ms:number}>();let next=1;
 const ui={classList:{toggle:(name:string,on:boolean)=>on?classes.add(name):classes.delete(name),remove:(name:string)=>classes.delete(name)},addEventListener:(name:string,fn:()=>void)=>events.set(name,fn),removeEventListener:(name:string)=>events.delete(name)};
 const frame={src:''},note={style:{display:''}};const requests:any[]=[];
 class MockXhr {url='';status=0;responseText='';readyState=0;onreadystatechange?:()=>void;onerror?:()=>void;ontimeout?:()=>void;timeout=0;open(_m:string,url:string){this.url=url;} send(){requests.push(this);} abort(){this.status=0;this.readyState=4;this.onreadystatechange?.();} reply(status:number,body:string){this.status=status;this.responseText=body;this.readyState=4;this.onreadystatechange?.();}}
 class TemplateElement{connectedCallback(){}disconnectedCallback(){}querySelector(){return ui;}}
 const ctx=vm.createContext({TemplateElement,XMLHttpRequest:MockXhr,window:{SimVar:{IsReady:()=>ready,GetSimVarValue: (name:string,units:string)=>{expect([name,units]).toEqual(['CAMERA STATE','Enum']);if(failCamera)throw Error('unavailable');return camera;}},customElements:{define:(_name:string,c:any)=>ctor=c}},document:{getElementById:(id:string)=>id==='FlapHappyFrame'?frame:note,body:{classList:{add:()=>{}}}},checkAutoload:()=>{},setTimeout:(fn:()=>void,ms:number)=>{const id=next++;timers.set(id,{fn,ms});return id;},clearTimeout:(id:number)=>timers.delete(id),setInterval:(fn:()=>void,ms:number)=>{const id=next++;timers.set(id,{fn,ms});return id;},clearInterval:(id:number)=>timers.delete(id)});
 vm.runInContext(script,ctx);const panel=new ctor();panel.connectedCallback();
 const tick=(ms:number)=>{for(const t of [...timers.values()])if(t.ms===ms)t.fn();};
 const preference=()=>requests.filter(r=>r.url.endsWith('/panel-settings')).at(-1);
 return {ctx,panel,ui,frame,note,events,timers,tick,preference,requests,hidden:()=>classes.has('fh-external-hidden'),camera:(v:unknown)=>{camera=v;tick(200);},cameraReady:(v:boolean)=>{ready=v;tick(200);},cameraFault:(v:boolean)=>{failCamera=v;tick(200);},activate:()=>events.get('panelActive')!(),deactivate:()=>events.get('panelInactive')!()};
}
describe('in-sim camera visibility',()=>{
 it('defaults off and persists only explicit true preferences',()=>{
  expect(defaultSettings().ui.auto_hide_external).toBe(false);
  expect(normalizeSettings({schema:'flaphappy.settings/1',ui:{}}).ui.auto_hide_external).toBe(false);
  expect(normalizeSettings({schema:'flaphappy.settings/1',ui:{auto_hide_external:true}}).ui.auto_hide_external).toBe(true);
  expect(normalizeSettings({schema:'flaphappy.settings/1',ui:{auto_hide_external:'true'}}).ui.auto_hide_external).toBe(false);
 });
 it('uses named MSFS 2024 external cameras, not ambiguous Waiting or Gameplay states',()=>{
  const h=harness();const external=h.ctx.fhIsExternalCamera;
  for(const value of [3,4,5,7,8])expect(external(value)).toBe(true);
  for(const value of [2,0,1,6,9,10,12,100,3.5,'3',null,undefined,NaN])expect(external(value)).toBe(false);
 });
 it('retains explicit On through request failures, restores cockpit and unknown views, and honors Off',()=>{
  const h=harness();h.camera(3);h.activate();expect(h.hidden()).toBe(false);
  h.preference().reply(200,'{"autoHideExternal":true}');expect(h.hidden()).toBe(true);
  const frame=h.frame.src;h.tick(1000);h.preference().reply(503,'');expect(h.hidden()).toBe(true);
  h.tick(1000);h.preference().reply(200,'{"autoHideExternal":null}');expect(h.hidden()).toBe(true);
  h.camera(2);expect(h.hidden()).toBe(false);h.camera(7);expect(h.hidden()).toBe(true);
  h.cameraReady(false);expect(h.hidden()).toBe(false);h.cameraReady(true);expect(h.hidden()).toBe(true);h.cameraFault(true);expect(h.hidden()).toBe(false);h.cameraFault(false);expect(h.hidden()).toBe(true);
  h.camera(9);expect(h.hidden()).toBe(false);h.camera(8);expect(h.hidden()).toBe(true);
  h.tick(1000);h.preference().reply(200,'{"autoHideExternal":false}');expect(h.hidden()).toBe(false);expect(h.frame.src).toBe(frame);
 });
 it('tears down timers and ignores late responses on inactivity and disconnection',()=>{
  const h=harness();h.camera(3);h.activate();const old=h.preference();h.deactivate();old.reply(200,'{"autoHideExternal":true}');expect(h.hidden()).toBe(false);
  expect([...h.timers.values()].filter(t=>[200,1000].includes(t.ms))).toHaveLength(0);
  h.activate();expect(h.hidden()).toBe(false);h.preference().reply(200,'{"autoHideExternal":true}');expect(h.hidden()).toBe(true);
  h.panel.disconnectedCallback();expect(h.hidden()).toBe(false);expect(h.events.size).toBe(0);expect([...h.timers.values()].filter(t=>[200,1000].includes(t.ms))).toHaveLength(0);
 });
});
