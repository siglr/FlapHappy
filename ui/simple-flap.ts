import type { DisplayModel } from '../core/display-model';
import { h, setText, toggleClass } from './dom';

interface Side {
  host: HTMLElement;
  pill: HTMLElement;
  text: HTMLElement;
}

/** One shared, Coherent-safe, flexbox view for the desktop and cockpit. */
export class SimpleFlapView {
  readonly el: HTMLElement;
  private readonly actual = h('span', { class: 'fh-simple-actual' }, '–');
  private readonly leftArrow = h('span', { class: 'fh-simple-arrow slower', 'aria-hidden': 'true' });
  private readonly rightArrow = h('span', { class: 'fh-simple-arrow faster', 'aria-hidden': 'true' });
  private readonly left = this.side();
  private readonly right = this.side();

  constructor() {
    const center = h('div', { class: 'fh-simple-current' },
      this.leftArrow, this.actual, this.rightArrow);
    this.el = h('div', { class: 'fh-simple-row', 'aria-label': 'Flap indicator' },
      this.left.host, center, this.right.host);
    this.el.style.display = 'none';
  }

  private side(): Side {
    const text = h('span', { class: 'fh-simple-suggest-text' });
    const pill = h('span', { class: 'fh-simple-pill' }, text);
    const host = h('div', { class: 'fh-simple-side' }, pill);
    pill.style.display = 'none';
    return { host, pill, text };
  }

  render(model: DisplayModel, visible: boolean): void {
    this.el.style.display = visible ? 'flex' : 'none';
    const value = model.simple;
    const current = value.current;
    const suggested = visible && current !== null ? value.suggestion : null;
    setText(this.actual, current ?? '–');
    toggleClass(this.actual.parentNode as HTMLElement, 'unknown', current === null);
    this.actual.setAttribute('aria-label', 'Current flap: ' + (current ?? 'unavailable'));
    const slower = suggested && suggested.direction === 'slower';
    const faster = suggested && suggested.direction === 'faster';
    toggleClass(this.leftArrow, 'on', !!slower);
    toggleClass(this.rightArrow, 'on', !!faster);
    this.showSide(this.left, slower ? suggested.label : '');
    this.showSide(this.right, faster ? suggested.label : '');
    this.fit();
  }

  private showSide(side: Side, label: string): void {
    side.pill.style.display = label ? 'inline-block' : 'none';
    setText(side.text, label);
    side.pill.setAttribute('aria-label', label ? 'Suggested flap: ' + label : '');
    side.pill.title = label;
  }

  /** Measure in unscaled CSS pixels so the strip's zoom cannot change fit decisions. */
  fit(): void {
    if (this.el.style.display === 'none') return;
    for (const side of [this.left, this.right]) {
      if (!side.text.textContent || !side.host.clientWidth) continue;
      const available = side.host.clientWidth - 8;
      side.text.style.fontSize = '';
      side.text.style.whiteSpace = '';
      side.text.style.maxWidth = '';
      const padding = Math.max(3, Math.min(8, available / 20));
      side.pill.style.paddingLeft = padding + 'px';
      side.pill.style.paddingRight = padding + 'px';
      const space = Math.max(1, available - 2 * padding);
      const natural = side.text.offsetWidth;
      if (natural > space) {
        const base = 28;
        side.text.style.fontSize = Math.max(13, base * space / natural - 0.5) + 'px';
        if (side.text.offsetWidth > space) {
          side.text.style.maxWidth = space + 'px';
          side.text.style.whiteSpace = 'normal';
        }
      }
    }
  }
}
