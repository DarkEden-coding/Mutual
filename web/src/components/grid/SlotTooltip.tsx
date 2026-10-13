import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { SlotRoster } from '../../lib/bestTimes';
import { RosterGroups } from '../GroupWidgets';

export interface SlotTipData {
  /** e.g. "Tuesday · 12:30-12:45 PM" */
  when: string;
  /** e.g. "4/5 available (1 if needed)" */
  summary: string;
  roster: SlotRoster;
}

const MARGIN = 8;
const GAP = 8;

/** Picks a spot beside the anchor (right, left, above, below) that fits; clamps and caps height otherwise. */
function place(a: DOMRect, w: number, h: number, vw: number, vh: number) {
  const maxH = vh - MARGIN * 2;
  const hh = Math.min(h, maxH);
  const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - hh - MARGIN));
  const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - w - MARGIN));
  if (a.right + GAP + w + MARGIN <= vw) return { x: a.right + GAP, y: clampY(a.top + a.height / 2 - hh / 2), maxH };
  if (a.left - GAP - w >= MARGIN) return { x: a.left - GAP - w, y: clampY(a.top + a.height / 2 - hh / 2), maxH };
  const above = a.top - GAP - MARGIN;
  const below = vh - a.bottom - GAP - MARGIN;
  if (above >= hh) return { x: clampX(a.left + a.width / 2 - w / 2), y: a.top - GAP - hh, maxH: above };
  if (below >= hh) return { x: clampX(a.left + a.width / 2 - w / 2), y: a.bottom + GAP, maxH: below };
  // Tall tooltip: take the roomier side and let it scroll.
  if (Math.max(above, below) >= 96) {
    const up = above > below;
    const room = up ? above : below;
    return { x: clampX(a.left + a.width / 2 - w / 2), y: up ? a.top - GAP - room : a.bottom + GAP, maxH: room };
  }
  // Almost no vertical room: sit beside the cell on whichever side has more space.
  const roomRight = vw - a.right - GAP - MARGIN;
  const roomLeft = a.left - GAP - MARGIN;
  return { x: clampX(roomRight >= roomLeft ? a.right + GAP : a.left - GAP - w), y: clampY(a.top + a.height / 2 - hh / 2), maxH };
}

/**
 * Themed popover card for the heatmap: slot time, summary and the grouped roster. Portalled to <body>
 * and fixed beside the anchor cell (never over it). Hover tooltips ignore the pointer; a pinned one
 * (`pinned`) takes pointer events so a long roster can scroll. Screen readers get the same info from
 * the live region in HeatGrid, so this card is aria-hidden.
 */
export function SlotTooltip({ data, anchor, pinned }: { data: SlotTipData; anchor: HTMLElement | null; pinned: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const update = () => {
      el.style.maxHeight = '';
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const r = el.getBoundingClientRect();
      const p = place(anchor.getBoundingClientRect(), r.width, r.height, vw, vh);
      el.style.maxHeight = `${Math.floor(p.maxH)}px`;
      el.style.left = `${Math.round(p.x)}px`;
      el.style.top = `${Math.round(p.y)}px`;
      el.style.visibility = 'visible';
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor, data]);

  return createPortal(
    <div
      ref={ref}
      className={`m-tooltip${pinned ? ' is-pinned' : ''}`}
      aria-hidden="true"
      style={{ left: 0, top: 0, visibility: 'hidden' }}
    >
      <div className="m-tooltip-title">{data.when}</div>
      <div className="m-tooltip-summary">{data.summary}</div>
      <RosterGroups roster={data.roster} />
    </div>,
    document.body,
  );
}
