import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { heatIntensity, rosterForSlot, type GroupCounts } from '../../lib/bestTimes';
import type { ViewGrid } from '../../lib/slots';
import { formatMinuteRange } from '../../lib/slots';
import { SlotTooltip, type SlotTipData } from './SlotTooltip';
import { GridHeads, arrowTarget, cellFromNode, firstEnabledCell, focusCell, gridStyle } from './GridParts';

interface Props {
  view: ViewGrid;
  counts: GroupCounts;
  /** slot currently hovered/pinned (drives the `is-hovered` outline) */
  activeSlot: number | null;
  onHoverSlot: (slot: number | null) => void;
  onTapSlot: (slot: number) => void;
  /** slot pinned by click/tap (its tooltip stays open and scrollable) */
  pinnedSlot: number | null;
  /** tap outside the grid / Escape while a slot is pinned */
  onDismissPin: () => void;
  /** people (name + availability string) used for the tooltip roster */
  participants: Parameters<typeof rosterForSlot>[0];
  /** slots of the selected "best time" block */
  bestSlots: ReadonlySet<number> | null;
  /** availability string of the participant being highlighted */
  personAvailability: string | null;
  ariaLabel: string;
}

interface RowProps {
  view: ViewGrid;
  r: number;
  keyStr: string;
  total: number;
}

/**
 * Per-cell key: '-' (disabled) or `<percent>.<flags>` joined by ','. Flags:
 *  h hovered, b best block, d dimmed, p person available, q person if-needed.
 * Last segment after ';' is the roving-focus column.
 */
const Row = memo(function Row({ view, r, keyStr, total }: RowProps) {
  const row = view.rows[r];
  const [cellsPart, focusPart] = keyStr.split(';');
  const focusCol = focusPart === undefined ? -1 : Number(focusPart);
  const hour = r > 0 && row.minute % 60 === 0;
  return (
    <>
      {row.gapBefore && <div className="m-grid-gap" role="presentation" />}
      <div className="m-grid-rowhead" role="rowheader">
        {row.showLabel ? row.label : ''}
      </div>
      {cellsPart.split(',').map((k, c) => {
        if (k === '-') {
          return <div key={c} className="m-heat-cell is-disabled" role="gridcell" aria-disabled="true" data-r={r} data-c={c} tabIndex={-1} />;
        }
        const [pct, flags = ''] = k.split('.');
        const cls = [
          'm-heat-cell',
          flags.includes('h') && 'is-hovered',
          flags.includes('b') && 'is-best',
          flags.includes('d') && 'is-dimmed',
          flags.includes('p') && 'is-person-available',
          flags.includes('q') && 'is-person-ifneeded',
          hour && 'is-hour-start',
        ]
          .filter(Boolean)
          .join(' ');
        const slot = view.cells[r * view.cols + c];
        return (
          <div
            key={c}
            className={cls}
            role="gridcell"
            data-r={r}
            data-c={c}
            data-slot={slot}
            tabIndex={c === focusCol ? 0 : -1}
            style={{ ['--heat' as string]: Number(pct) / 100 }}
            aria-label={`${view.columns[c].fullLabel}, ${row.label}: ${Math.round((Number(pct) / 100) * total * 10) / 10} of ${total}`}
          />
        );
      })}
    </>
  );
});

export function HeatGrid({
  view,
  counts,
  activeSlot,
  onHoverSlot,
  onTapSlot,
  pinnedSlot,
  onDismissPin,
  participants,
  bestSlots,
  personAvailability,
  ariaLabel,
}: Props) {
  const [focus, setFocus] = useState(() => firstEnabledCell(view));
  const gridRef = useRef<HTMLDivElement>(null);

  const rowKeys = useMemo(() => {
    const keys: string[] = [];
    for (let r = 0; r < view.nrows; r++) {
      const parts: string[] = [];
      for (let c = 0; c < view.cols; c++) {
        const slot = view.cells[r * view.cols + c];
        if (slot < 0) {
          parts.push('-');
          continue;
        }
        let flags = '';
        if (slot === activeSlot) flags += 'h';
        if (bestSlots?.has(slot)) flags += 'b';
        if (personAvailability) {
          const ch = personAvailability[slot];
          if (ch === '1') flags += 'p';
          else if (ch === '2') flags += 'q';
          else flags += 'd';
        }
        parts.push(`${Math.round(heatIntensity(counts, slot) * 100)}.${flags}`);
      }
      let s = parts.join(',');
      if (focus.row === r) s += `;${focus.col}`;
      keys.push(s);
    }
    return keys;
  }, [view, counts, activeSlot, bestSlots, personAvailability, focus.row, focus.col]);

  const slotAtTarget = (target: EventTarget | null) => {
    const cell = cellFromNode(target as Element);
    if (!cell) return null;
    const slot = view.cells[cell.row * view.cols + cell.col];
    return slot >= 0 ? { cell, slot } : null;
  };

  const tip = useMemo<SlotTipData | null>(() => {
    if (activeSlot === null) return null;
    const pos = view.slotPos[activeSlot];
    if (pos === undefined || pos < 0) return null;
    const col = view.columns[pos % view.cols];
    const row = view.rows[Math.floor(pos / view.cols)];
    const a = counts.available[activeSlot];
    const i = counts.ifNeeded[activeSlot];
    return {
      when: `${col.fullLabel} · ${formatMinuteRange(row.minute, row.minute + view.slotMinutes)}`,
      summary: `${a + i}/${counts.participants} available${i ? ` (${i} if needed)` : ''}`,
      roster: rosterForSlot(participants, activeSlot),
    };
  }, [activeSlot, view, counts, participants]);

  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setAnchor(activeSlot === null ? null : (gridRef.current?.querySelector<HTMLElement>(`[data-slot="${activeSlot}"]`) ?? null));
  }, [activeSlot, view]);

  // Dismiss a pinned tooltip by tapping elsewhere (the same/another cell is handled by onClick) or Escape.
  useEffect(() => {
    if (pinnedSlot === null) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.m-heat-cell[data-slot], .m-tooltip')) return;
      onDismissPin();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onDismissPin();
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [pinnedSlot, onDismissPin]);

  const liveText = tip
    ? [
        `${tip.when}. ${tip.summary}.`,
        tip.roster.available.length ? `Available: ${tip.roster.available.join(', ')}.` : '',
        tip.roster.ifNeeded.length ? `If needed: ${tip.roster.ifNeeded.join(', ')}.` : '',
        tip.roster.unavailable.length ? `Unavailable: ${tip.roster.unavailable.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <div className="m-grid-wrap" data-variant="heat">
      <div
        ref={gridRef}
        className="m-grid is-readonly"
        role="grid"
        aria-label={ariaLabel}
        aria-readonly="true"
        style={gridStyle(view)}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return;
          const hit = slotAtTarget(e.target);
          onHoverSlot(hit ? hit.slot : null);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse') return;
          onHoverSlot(null);
        }}
        onClick={(e) => {
          const hit = slotAtTarget(e.target);
          if (!hit) return;
          setFocus(hit.cell);
          onTapSlot(hit.slot);
        }}
        onFocus={(e) => {
          const hit = slotAtTarget(e.target);
          if (hit && e.target instanceof HTMLElement && e.target.matches(':focus-visible')) onHoverSlot(hit.slot);
        }}
        onBlur={() => onHoverSlot(null)}
        onKeyDown={(e) => {
          const cell = cellFromNode(e.target as Element);
          if (!cell) return;
          const t = arrowTarget(e, view, cell);
          if (t) {
            e.preventDefault();
            setFocus(t);
            focusCell(gridRef.current, t.row, t.col);
            const slot = view.cells[t.row * view.cols + t.col];
            onHoverSlot(slot >= 0 ? slot : null);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const slot = view.cells[cell.row * view.cols + cell.col];
            if (slot >= 0) onTapSlot(slot);
          }
        }}
      >
        <GridHeads view={view} />
        {rowKeys.map((k, r) => (
          <Row key={r} view={view} r={r} keyStr={k} total={counts.participants} />
        ))}
      </div>
      <div className="m-visually-hidden" aria-live="polite" aria-atomic="true">
        {liveText}
      </div>
      {tip && <SlotTooltip data={tip} anchor={anchor} pinned={activeSlot === pinnedSlot} />}
    </div>
  );
}
