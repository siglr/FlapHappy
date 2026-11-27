import { usesManualBallast, type WeightState } from '../core/weight';
import { ballastReadout, snapFraction } from '../core/ballast';
import type { BallastState } from '../core/ballast';
import type { Profile } from '../core/types';
import { h, setText } from './dom';
import { kilogramsToWeight, type WeightUnit } from '../core/units';

/**
 * Ballast slider: None (0) to Max (1). Click the track to set, drag with snap.
 * Mouse and touch events only (no pointer events, which the in-sim browser lacks).
 */
export class BallastSlider {
  readonly el: HTMLElement;
  private track: HTMLElement;
  private fill: HTMLElement;
  private thumb: HTMLElement;
  private readout: HTMLElement;
  private dragging = false;
  private active = false;
  private profile: Profile | null = null;

  constructor(private onChange: (f: number) => void) {
    this.fill = h('div', { class: 'fh-sl-fill' });
    this.thumb = h('div', { class: 'fh-sl-thumb' });
    this.track = h('div', { class: 'fh-sl-track' }, this.fill, this.thumb);
    this.readout = h('span', { class: 'fh-sl-pct' }, '0%');

    this.el = h(
      'div',
      { class: 'fh-row fh-ballast-row' },
      h('div', { class: 'fh-label' }, 'BALLAST'),
      h('div', { class: 'fh-sl' }, h('div', { class: 'fh-sl-trackwrap' }, this.track), h('div', { class: 'fh-sl-read' }, this.readout)),
    );

    const move = (clientX: number) => {
      if (!this.active) return;
      const r = this.track.getBoundingClientRect();
      const raw = r.width > 0 ? (clientX - r.left) / r.width : 0;
      this.commit(snapFraction(raw, this.snap()));
    };
    this.track.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      this.dragging = true;
      move(e.clientX);
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (this.dragging) move(e.clientX);
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
    });
    this.track.addEventListener('touchstart', (e) => {
      if (!this.active) return;
      this.dragging = true;
      if (e.touches[0]) move(e.touches[0].clientX);
      e.preventDefault();
    });
    this.track.addEventListener('touchmove', (e) => {
      if (this.dragging && e.touches[0]) move(e.touches[0].clientX);
      e.preventDefault();
    });
    this.track.addEventListener('touchend', () => {
      this.dragging = false;
    });
  }

  private snap(): number {
    return this.profile ? this.profile.ballast.drag_snap : 0.05;
  }

  private commit(f: number): void {
    this.paint(f);
    this.onChange(f);
  }

  render(profile: Profile | null, st: BallastState): void {
    if (this.profile?.id !== profile?.id) this.dragging = false;
    this.active = profile !== null;
    this.profile = profile;
    this.paint(st.f);
  }

  deactivate(): void {
    this.active = false;
    this.dragging = false;
    this.profile = null;
  }

  private paint(f: number): void {
    const pctText = this.profile ? ballastReadout(this.profile, f) : Math.round(f * 100) + '%';
    setText(this.readout, pctText);
    this.fill.style.width = f * 100 + '%';
    this.thumb.style.left = f * 100 + '%';
  }
}


/** Read-only indicator; actual flying weight is independent of the clamped thumb. */
export class WeightIndicator {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private thumb: HTMLElement;
  private readout: HTMLElement;

  constructor() {
    this.fill = h('div', { class: 'fh-sl-fill' });
    this.thumb = h('div', { class: 'fh-sl-thumb' });
    this.readout = h('span', { class: 'fh-sl-pct' }, '-- kg');
    const track = h('div', { class: 'fh-sl-track', 'aria-hidden': 'true' }, this.fill, this.thumb);
    this.el = h('div', { class: 'fh-row fh-weight-row' },
      h('div', { class: 'fh-label' }, 'WEIGHT'),
      h('div', { class: 'fh-sl' }, h('div', { class: 'fh-sl-trackwrap' }, track)),
      h('div', { class: 'fh-gr fh-sl-read' }, this.readout));
  }

  render(state: WeightState,unit:WeightUnit='kg'): void {
    setText(this.readout, (state.kg===null?'--':String(Math.round(kilogramsToWeight(state.kg,unit))))+' '+unit);
    const visible = state.fraction !== null;
    this.fill.style.display = this.thumb.style.display = visible ? '' : 'none';
    if (state.fraction !== null) {
      this.fill.style.width = state.fraction * 100 + '%';
      this.thumb.style.left = state.fraction * 100 + '%';
    }
  }
}

/** One row in either host, never an interactive slider in live-weight mode. */
export class WeightControl {
  readonly el = h('div', { class: 'fh-weight-control' });
  private weight = new WeightIndicator();
  private ballast: BallastSlider;

  constructor(onChange: (f: number) => void) {
    this.ballast = new BallastSlider(onChange);
  }

  render(profile: Profile | null, state: WeightState, manual: BallastState,unit:WeightUnit='kg'): void {
    const useManual = usesManualBallast(profile);
    const row = useManual ? this.ballast.el : this.weight.el;
    if (this.el.firstChild !== row) {
      if (this.el.firstChild) this.el.removeChild(this.el.firstChild);
      this.el.appendChild(row);
    }
    if (useManual) this.ballast.render(profile, manual);
    else {
      this.ballast.deactivate();
      this.weight.render(state,unit);
    }
  }
}
