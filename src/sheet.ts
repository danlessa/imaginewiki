import { tick } from './haptics.ts';

/**
 * On narrow screens the sidebar is a bottom sheet over the map. `peek` shows only the search bar, `half` shares the
 * screen with the map and `full` covers it. Wider screens keep the sidebar and ignore all of this.
 */
export type SheetState = 'peek' | 'half' | 'full';

const NARROW = window.matchMedia('(max-width: 760px)');
const PEEK_PX = 84;
const HALF = 0.5;
/** Movement below this is a tap on the handle rather than a drag. */
const TAP_PX = 6;
/** A release faster than this, in px per ms, carries on to the next state in that direction. */
const FLICK_SPEED = 0.5;

let sheet: HTMLElement;
let current: SheetState = 'peek';
let onSnap: (state: SheetState) => void = () => {};

export const isNarrow = () => NARROW.matches;
export const sheetState = () => current;

/** How much of the map the sheet covers once it settles, in pixels. */
export const sheetCover = () => (isNarrow() ? heights()[current] : 0);

function heights(): Record<SheetState, number> {
  const area = document.getElementById('map')!.clientHeight;
  return { peek: PEEK_PX, half: Math.round(area * HALF), full: area };
}

export function setSheet(state: SheetState) {
  if (state !== current && isNarrow()) tick();
  current = state;
  sheet.dataset.sheet = state;
  sheet.style.height = isNarrow() ? `${heights()[state]}px` : '';
}

export function setupSheet(element: HTMLElement, handle: HTMLElement, snapped: (state: SheetState) => void) {
  sheet = element;
  onSnap = snapped;
  setSheet('peek');
  NARROW.addEventListener('change', () => setSheet(current));
  window.addEventListener('resize', () => setSheet(current));

  let start: { y: number; height: number; time: number } | null = null;
  let last = { y: 0, time: 0 };
  handle.addEventListener('pointerdown', (e) => {
    if (!isNarrow()) return;
    handle.setPointerCapture(e.pointerId);
    start = { y: e.clientY, height: sheet.getBoundingClientRect().height, time: e.timeStamp };
    last = { y: e.clientY, time: e.timeStamp };
    sheet.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    const { peek, full } = heights();
    sheet.style.height = `${Math.min(full, Math.max(peek, start.height + start.y - e.clientY))}px`;
    last = { y: e.clientY, time: e.timeStamp };
  });
  const release = (e: PointerEvent) => {
    if (!start) return;
    sheet.classList.remove('dragging');
    const moved = start.y - e.clientY;
    const speed = (last.y - e.clientY) / Math.max(1, e.timeStamp - last.time) || moved / Math.max(1, e.timeStamp - start.time);
    start = null;
    const order: SheetState[] = ['peek', 'half', 'full'];
    let next: SheetState;
    if (Math.abs(moved) < TAP_PX) {
      next = current === 'peek' ? 'half' : current === 'half' ? 'full' : 'half';
    } else if (Math.abs(speed) > FLICK_SPEED) {
      const height = sheet.getBoundingClientRect().height;
      const h = heights();
      // Flicks go to the next state past the current height in the flick's direction.
      next = speed > 0 ? (order.find((s) => h[s] > height + 1) ?? 'full') : ([...order].reverse().find((s) => h[s] < height - 1) ?? 'peek');
    } else {
      const height = sheet.getBoundingClientRect().height;
      const h = heights();
      next = order.reduce((a, b) => (Math.abs(h[b] - height) < Math.abs(h[a] - height) ? b : a));
    }
    setSheet(next);
    onSnap(next);
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
}
