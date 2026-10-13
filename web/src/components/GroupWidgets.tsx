import { useCallback, useEffect, useRef, useState } from 'react';
import type { BestBlock, SlotRoster } from '../lib/bestTimes';
import { formatMinuteRange, type ViewGrid } from '../lib/slots';
import type { ParticipantDTO } from '../api';
import { IconLock } from './Icons';

export function GroupLegend({ participants }: { participants: number }) {
  const n = participants;
  return (
    <div className="m-legend" aria-label="Legend">
      <span className="m-legend-scale">
        <span>{n > 0 ? `0/${n}` : 'Nobody'}</span>
        <span
          className="m-legend-bar"
          role="img"
          aria-label={n > 0 ? `From nobody available to all ${n} available` : 'From nobody available to everyone available'}
        />
        <span>{n > 0 ? `${n}/${n}` : 'Everyone'}</span>
      </span>
      <span className="m-legend-item">
        <span className="m-legend-swatch is-disabled" />
        Not an event time
      </span>
    </div>
  );
}

export function BrushLegend() {
  return (
    <div className="m-legend" aria-label="Legend">
      <span className="m-legend-item">
        <span className="m-legend-swatch is-available" />
        Available
      </span>
      <span className="m-legend-item">
        <span className="m-legend-swatch is-ifneeded" />
        If needed
      </span>
      <span className="m-legend-item">
        <span className="m-legend-swatch is-disabled" />
        Not an event time
      </span>
    </div>
  );
}

export function blockLabel(block: BestBlock, view: ViewGrid): string {
  return `${view.columns[block.col].fullLabel} · ${formatMinuteRange(block.startMinute, block.endMinute)}`;
}

export function blockMeta(block: BestBlock): string {
  const attending = block.available + block.ifNeeded;
  return `${attending}/${block.total} available${block.ifNeeded ? ` (${block.ifNeeded} if needed)` : ''}`;
}

export function BestTimes({
  blocks,
  view,
  activeId,
  onSelect,
  onHover,
}: {
  blocks: BestBlock[];
  view: ViewGrid;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onHover?: (id: string | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = el.scrollLeft > 2;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((cur) => (cur.start === start && cur.end === end ? cur : { start, end }));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Let a plain mouse wheel scroll the strip sideways when it overflows.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
      if (atStart || atEnd) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [measure, blocks.length]);

  return (
    <div className="m-best-strip" role="group" aria-labelledby="best-title">
      <span className="m-best-label" id="best-title">
        Best times
      </span>
      {blocks.length === 0 ? (
        <p className="m-best-empty">Best times will appear once people respond</p>
      ) : (
        <div
          className="m-best-scroll"
          data-fade-start={edges.start || undefined}
          data-fade-end={edges.end || undefined}
          ref={scrollRef}
          onScroll={measure}
        >
          <ol className="m-best">
            {blocks.map((b, i) => {
              const col = view.columns[b.col];
              const when = `${col.label} ${formatMinuteRange(b.startMinute, b.endMinute)}`;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    className={`m-best-item${activeId === b.id ? ' is-active' : ''}`}
                    aria-pressed={activeId === b.id}
                    aria-label={`${i + 1}. ${blockLabel(b, view)}, ${blockMeta(b)}`}
                    title={`${blockLabel(b, view)} · ${blockMeta(b)}`}
                    onClick={() => onSelect(activeId === b.id ? null : b.id)}
                    onMouseEnter={() => onHover?.(b.id)}
                    onMouseLeave={() => onHover?.(null)}
                    onFocus={() => onHover?.(b.id)}
                    onBlur={() => onHover?.(null)}
                  >
                    <span className="m-best-rank" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="m-best-when">{when}</span>
                    <span className="m-best-meta">
                      {b.available + b.ifNeeded}/{b.total}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Grouped names (Available / If needed / Unavailable) for one slot. Rendered inside the heatmap tooltip. */
export function RosterGroups({ roster }: { roster: SlotRoster }) {
  return (
    <div className="m-roster">
      <RosterGroup kind="available" heading="Available" names={roster.available} />
      <RosterGroup kind="ifneeded" heading="If needed" names={roster.ifNeeded} />
      <RosterGroup kind="unavailable" heading="Unavailable" names={roster.unavailable} />
    </div>
  );
}

function RosterGroup({ kind, heading, names }: { kind: 'available' | 'ifneeded' | 'unavailable'; heading: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className={`m-roster-group is-${kind}`}>
      <span className="m-roster-heading">
        <span className="m-roster-dot" aria-hidden="true" />
        {heading}
        <span className="m-roster-count">{names.length}</span>
      </span>
      <span className="m-roster-names">
        {names.map((n, i) => (
          <span key={`${n}-${i}`} className={`m-roster-name${kind === 'unavailable' ? ' is-unavailable' : ''}`}>
            {n}
            {i < names.length - 1 ? ',' : ''}
          </span>
        ))}
      </span>
    </div>
  );
}

export function ParticipantList({
  participants,
  meId,
  activeId,
  onActive,
}: {
  participants: ParticipantDTO[];
  meId: string | null;
  activeId: string | null;
  onActive: (id: string | null) => void;
}) {
  if (participants.length === 0) return <p className="m-hint">No responses yet. Be the first!</p>;
  return (
    <ul className="m-participants">
      {participants.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            className={`m-participant${p.id === meId ? ' is-me' : ''}${activeId === p.id ? ' is-active' : ''}`}
            aria-pressed={activeId === p.id}
            onMouseEnter={() => onActive(p.id)}
            onMouseLeave={() => onActive(null)}
            onFocus={() => onActive(p.id)}
            onBlur={() => onActive(null)}
            onClick={() => onActive(activeId === p.id ? null : p.id)}
          >
            {p.name}
            {p.hasPassword && <IconLock size={12} aria-label="Password protected" />}
            {p.id === meId && <span className="m-badge is-accent">You</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
