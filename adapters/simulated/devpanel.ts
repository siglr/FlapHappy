import { h, setText } from '../../ui/dom';
import type { App } from '../../ui/app';
import { FAULTS, type Fault } from './simulated-source';
import { ScenarioPlayer, type Scenario } from './scenario';
import iasSweep from './scenarios/ias-sweep.json';
import lever from './scenarios/lever-sequence.json';
import ballastSweep from './scenarios/ballast-sweep.json';
import connect from './scenarios/connect-cycle.json';
import faults from './scenarios/faults-tour.json';
import soak from './scenarios/combined-soak.json';

export const SCENARIOS: Scenario[] = [iasSweep, lever, ballastSweep, connect, faults, soak] as unknown as Scenario[];

/**
 * Dev-only control panel for the simulated source (hidden in normal use; shown with --source=simulated,
 * --dev, or on the browser harness page). Everything here drives `SimulatedSource.controls`.
 */
export function mountDevPanel(container: HTMLElement, app: App): void {
  const sim = app.sim;
  const c = sim.controls;
  const readouts: Record<string, HTMLElement> = {};
  const row = (...kids: Array<HTMLElement | null>) => h('div', { class: 'fh-devrow' }, ...kids);
  const lab = (t: string) => h('label', { class: 'fh-devlab' }, t);

  const iasRange = h('input', { type: 'range', min: '0', max: '220', step: '0.5', value: String(c.iasKt), class: 'fh-dev-ias', 'aria-label': 'Simulated IAS', oninput: (e: Event) => setIas(Number((e.target as HTMLInputElement).value)) }) as HTMLInputElement;
  const iasNum = h('input', { type: 'number', step: '0.5', value: String(c.iasKt), class: 'fh-in fh-dev-iasnum', 'aria-label': 'Simulated IAS number', oninput: (e: Event) => setIas(Number((e.target as HTMLInputElement).value)) }) as HTMLInputElement;
  function setIas(v: number): void {
    if (!isFinite(v)) return;
    c.iasKt = v;
    iasRange.value = String(v);
    if (document.activeElement !== iasNum) iasNum.value = String(v);
    sim.tick(0);
  }

  const aglRange = h('input', { type: 'range', min: '0', max: '2000', step: '10', value: String(c.aglFt), class: 'fh-dev-aglrange', 'aria-label': 'Simulated AGL', oninput: (e: Event) => setAgl(Number((e.target as HTMLInputElement).value)) }) as HTMLInputElement;
  const aglNum = h('input', { type: 'number', min: '0', max: '20000', step: '10', value: String(c.aglFt), class: 'fh-in fh-dev-agl', 'aria-label': 'Simulated height above ground', oninput: (e: Event) => setAgl(Number((e.target as HTMLInputElement).value)) }) as HTMLInputElement;
  function setAgl(v: number): void {
    if (!isFinite(v)) return;
    c.aglFt = v;
    aglRange.value = String(v);
    if (document.activeElement !== aglNum) aglNum.value = String(v);
    sim.tick(0);
  }

  const windRange = h('input', { type: 'range', min: '0', max: '40', step: '1', value: String(c.windKt), class: 'fh-dev-aglrange', 'aria-label': 'Simulated wind', oninput: (e: Event) => setWind(Number((e.target as HTMLInputElement).value)) }) as HTMLInputElement;
  const windNum = h('input', { type: 'number', min: '0', max: '200', step: '1', value: String(c.windKt), class: 'fh-in fh-dev-agl', 'aria-label': 'Simulated wind speed', oninput: (e: Event) => setWind(Number((e.target as HTMLInputElement).value)) }) as HTMLInputElement;
  function setWind(v: number): void {
    if (!isFinite(v)) return;
    c.windKt = Math.max(0, v);
    windRange.value = String(c.windKt);
    if (document.activeElement !== windNum) windNum.value = String(c.windKt);
    sim.tick(0);
  }

  const flapSel = h('select', { class: 'fh-select fh-dev-flap', 'aria-label': 'Simulated flap handle index', onchange: (e: Event) => { c.flapIndex = Number((e.target as HTMLSelectElement).value); sim.tick(0); } }) as HTMLSelectElement;
  const count = h('input', { type: 'number', min: '0', max: '16', value: String(c.flapCount), class: 'fh-in fh-dev-count', 'aria-label': 'Simulated flap count', oninput: (e: Event) => { sim.setFlapCount(Number((e.target as HTMLInputElement).value)); fillFlaps(); sim.tick(0); } }) as HTMLInputElement;
  function fillFlaps(): void {
    while (flapSel.firstChild) flapSel.removeChild(flapSel.firstChild);
    const n = Math.max(c.flapCount, 1);
    for (let i = 0; i < n; i++) {
      const o = h('option', { value: String(i) }, String(i)) as HTMLOptionElement;
      o.selected = i === c.flapIndex;
      flapSel.appendChild(o);
    }
  }
  fillFlaps();
  const weightRange=h('input',{type:'range',min:'280',max:'1000',step:'1',value:'280',class:'fh-dev-weight-range','aria-label':'Simulated weight slider (kg)',oninput:(e:Event)=>setWeight(Number((e.target as HTMLInputElement).value))}) as HTMLInputElement;
  const weightInput=h('input',{type:'number',min:'0',step:'1',class:'fh-in fh-dev-weight',placeholder:'Unavailable',value:c.totalWeightKg===null?'':String(c.totalWeightKg),'aria-label':'Simulated weight (kg)',oninput:(e:Event)=>{const v=(e.target as HTMLInputElement).value;setWeight(v?Number(v):null,false);},onchange:()=>syncWeight()}) as HTMLInputElement;
  const weightState=h('span',{class:'fh-devstate'});
  function syncWeight(syncNumber=true):void {
    const p=app.profile;
    const values=[p?.weight_kg.light,p?.weight_kg.heavy,c.totalWeightKg].filter((v):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0);
    const lo=Math.min(280,...values.map(Math.floor)),hi=Math.max(1000,...values.map(Math.ceil));
    weightRange.min=String(lo);weightRange.max=String(hi);
    const available=typeof c.totalWeightKg==='number'&&Number.isFinite(c.totalWeightKg)&&c.totalWeightKg>0;
    if(available)weightRange.value=String(c.totalWeightKg);else weightRange.value=String(Math.max(lo,Math.min(hi,Number(weightRange.value)||lo)));
    if(syncNumber)weightInput.value=c.totalWeightKg===null?'':String(c.totalWeightKg);
    setText(weightState,available?'kg':'kg (unavailable)');
  }
  function setWeight(value:number|null,syncNumber=true):void {
    if(value!==null&&!Number.isFinite(value))return;
    c.totalWeightKg=value===null?null:Math.max(0,Math.round(value));syncWeight(syncNumber);sim.tick(0);
  }
  syncWeight();
  sim.onProfilePrimed(()=>{count.value=String(c.flapCount);syncWeight();fillFlaps();});
  const resetCount=h('button',{type:'button',class:'fh-btn fh-dev-reset-count',onclick:()=>{if(sim.primeProfile(app.profile,true))sim.tick(0);}},'Use profile count');

  const toggle = (label: string, key: 'connected' | 'inFlight' | 'onGround', cls: string) =>
    h('label', { class: 'fh-check' }, h('input', { type: 'checkbox', class: cls, checked: c[key], onchange: (e: Event) => { c[key] = (e.target as HTMLInputElement).checked; sim.tick(0); } }), ' ' + label);

  const faultBtns = FAULTS.map((f: Fault) => h('button', { class: 'fh-btn fh-fault', type: 'button', 'data-fault': f, onclick: () => { c.fault = f; setText(readouts.fault, 'fault: ' + f); sim.tick(0); } }, f));
  readouts.fault = h('span', { class: 'fh-devstate' }, 'fault: none');

  const title = h('input', { type: 'text', class: 'fh-in fh-dev-title', value: c.title, 'aria-label': 'Simulated aircraft title', oninput: (e: Event) => { c.title = (e.target as HTMLInputElement).value; } });

  // Scenario runner (fixed 100 ms steps, driven by wall clock).
  let player: ScenarioPlayer | null = null;
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const scenSel = h('select', { class: 'fh-select fh-dev-scen', 'aria-label': 'Scenario' }, ...SCENARIOS.map((s, i) => h('option', { value: String(i) }, s.name))) as HTMLSelectElement;
  const scenState = h('span', { class: 'fh-devstate' }, 'idle');
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    player = null;
    setText(scenState, 'idle');
  };
  const play = () => {
    stop();
    const sc = SCENARIOS[Number(scenSel.value)];
    const b = app.currentBoundaries();
    const p = app.profile;
    player = new ScenarioPlayer(sc, {
      vs: b ? b[0] : null,
      vne: b ? b[b.length - 1] : null,
      rowHandles: p ? p.flaps.map((r) => r.handle_index ?? 0) : [],
    });
    startedAt = Date.now();
    setText(scenState, 'running: ' + sc.name);
    timer = setInterval(() => {
      if (!player) return;
      const b2 = app.currentBoundaries();
      player.ctx.vs = b2 ? b2[0] : player.ctx.vs;
      player.ctx.vne = b2 ? b2[b2.length - 1] : player.ctx.vne;
      const out = player.at((Date.now() - startedAt) / 1000);
      if (out.connected !== undefined) c.connected = out.connected;
      if (out.inFlight !== undefined) c.inFlight = out.inFlight;
      if (out.onGround !== undefined) c.onGround = out.onGround;
      if (out.iasKt !== undefined) setIas(out.iasKt);
      if (out.flapIndex !== undefined) c.flapIndex = out.flapIndex;
      if (out.fault !== undefined) c.fault = out.fault;
      if (out.ballast !== undefined) app.setBallast(out.ballast, true);
      if (flapSel.value !== String(c.flapIndex)) fillFlaps();
    }, 100);
  };

  const ballastSweepBtn = h('button', { class: 'fh-btn', type: 'button', onclick: () => { scenSel.value = '2'; play(); } }, 'Ballast sweep');

  container.appendChild(
    h('div', { class: 'fh-devpanel' },
      h('div', { class: 'fh-devtitle' }, 'DEV: simulated source'),
      row(lab('IAS'), iasRange, iasNum, lab('kt')),
      row(lab('Simulated weight'),weightRange,weightInput,weightState),
      row(lab('AGL'), aglRange, aglNum, lab('ft')),
      row(lab('Wind'), windRange, windNum, lab('kt')),
      row(lab('Flap handle index'), flapSel, lab('count'), count, resetCount, lab('title'), title),
      row(toggle('connected', 'connected', 'fh-dev-connected'), toggle('in flight (not paused)', 'inFlight', 'fh-dev-inflight'), toggle('on ground', 'onGround', 'fh-dev-ground')),
      row(lab('Inject fault'), ...faultBtns, readouts.fault),
      row(lab('Scenario'), scenSel, h('button', { class: 'fh-btn fh-dev-play', type: 'button', onclick: play }, 'Play'), h('button', { class: 'fh-btn fh-dev-stop', type: 'button', onclick: stop }, 'Stop'), ballastSweepBtn, scenState),
    ),
  );
}
