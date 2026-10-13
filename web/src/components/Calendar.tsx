import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, parseDateKey, REFERENCE_DAY_FIX, toDateKey, weekdayIndex } from '../lib/dates';
import { IconChevronLeft, IconChevronRight } from './Icons';
import { Tooltip } from './Tooltip';

interface Props {
  selected: string[];
  onChange: (dates: string[]) => void;
  /** dates before this key are disabled */
  min?: string;
  maxDates?: number;
  onLimit?: () => void;
}

interface Drag {
  start: number;
  cur: number;
  remove: boolean;
}

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Month calendar with click and click-and-drag multi-select.
 * Dragging from a selected day removes the range; from an unselected day adds it.
 */
export function Calendar({ selected, onChange, min, maxDates = 62, onLimit }: Props) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const initial = selected[0] ?? min ?? toDateKey(new Date().getFullYear(), new Date().getMonth() + 1, 1);
  const [view, setView] = useState(() => {
    const p = parseDateKey(initial);
    return { year: p.year, month: p.month };
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const live = useRef({ selected, onChange, maxDates, onLimit });
  live.current = { selected, onChange, maxDates, onLimit };

  const nDays = daysInMonth(view.year, view.month);
  const lead = weekdayIndex(toDateKey(view.year, view.month, 1));
  const keyOf = (day: number) => toDateKey(view.year, view.month, day);
  const isDisabled = (day: number) => (min ? keyOf(day) < min : false);
  const today = toDateKey(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());

  const monthRef = useRef({ year: view.year, month: view.month, min });
  monthRef.current = { year: view.year, month: view.month, min };

  const apply = (d: Drag) => {
    const { year, month, min: mn } = monthRef.current;
    const lo = Math.min(d.start, d.cur);
    const hi = Math.max(d.start, d.cur);
    const next = new Set(live.current.selected);
    let limited = false;
    for (let day = lo; day <= hi; day++) {
      const k = toDateKey(year, month, day);
      if (mn && k < mn) continue;
      if (d.remove) next.delete(k);
      else if (next.size >= live.current.maxDates) limited = true;
      else next.add(k);
    }
    live.current.onChange([...next].sort());
    if (limited) live.current.onLimit?.();
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-day]');
      if (!el || !dragRef.current) return;
      const day = Number(el.dataset.day);
      if (day !== dragRef.current.cur) {
        dragRef.current = { ...dragRef.current, cur: day };
        setDrag(dragRef.current);
      }
    };
    const up = () => {
      if (dragRef.current) apply(dragRef.current);
      dragRef.current = null;
      setDrag(null);
    };
    const cancel = () => {
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const d = new Date(Date.UTC(v.year, v.month - 1 + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    });
  };

  const minMonth = min ? parseDateKey(min) : null;
  const canGoPrev = !minMonth || view.year > minMonth.year || (view.year === minMonth.year && view.month > minMonth.month);

  const previewState = (day: number): 'add' | 'remove' | null => {
    if (!drag) return null;
    const lo = Math.min(drag.start, drag.cur);
    const hi = Math.max(drag.start, drag.cur);
    if (day < lo || day > hi) return null;
    return drag.remove ? 'remove' : 'add';
  };

  const weekdayNames = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(`${addDays(REFERENCE_DAY_FIX, i)}T00:00:00Z`)));

  return (
    <div className="m-calendar" role="group" aria-label="Choose dates">
      <div className="m-calendar-header">
        <Tooltip content="Previous month">
          <button
            type="button"
            className="m-button is-ghost is-icon is-small"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
            disabled={!canGoPrev}
          >
            <IconChevronLeft />
          </button>
        </Tooltip>
        <div className="m-calendar-title" aria-live="polite">
          {monthFmt.format(new Date(Date.UTC(view.year, view.month - 1, 1)))}
        </div>
        <Tooltip content="Next month">
          <button type="button" className="m-button is-ghost is-icon is-small" aria-label="Next month" onClick={() => shiftMonth(1)}>
            <IconChevronRight />
          </button>
        </Tooltip>
      </div>
      <div className="m-calendar-weekdays" aria-hidden="true">
        {weekdayNames.map((n, i) => (
          <div key={i} className="m-calendar-weekday">
            {n.slice(0, 2)}
          </div>
        ))}
      </div>
      <div className="m-calendar-days">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`b${i}`} className="m-calendar-blank" />
        ))}
        {Array.from({ length: nDays }, (_, i) => {
          const day = i + 1;
          const key = keyOf(day);
          const disabled = isDisabled(day);
          const isSel = selectedSet.has(key);
          const pv = previewState(day);
          const cls = [
            'm-calendar-day',
            isSel && 'is-selected',
            key === today && 'is-today',
            disabled && 'is-disabled',
            pv === 'add' && 'is-preview',
            pv === 'remove' && 'is-preview-remove',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={key}
              type="button"
              data-day={day}
              className={cls}
              disabled={disabled}
              aria-pressed={isSel}
              aria-label={longFmt.format(new Date(Date.UTC(view.year, view.month - 1, day)))}
              onPointerDown={(e) => {
                if (e.button !== 0 || disabled) return;
                e.preventDefault();
                const d = { start: day, cur: day, remove: isSel };
                dragRef.current = d;
                setDrag(d);
              }}
              onClick={(e) => {
                // Keyboard activation only (pointer interactions are handled by the drag logic).
                if (e.detail !== 0) return;
                apply({ start: day, cur: day, remove: isSel });
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="m-calendar-footer">
        <span>
          {selected.length === 0 ? 'Click or drag to pick dates' : `${selected.length} date${selected.length === 1 ? '' : 's'} selected`}
        </span>
        {selected.length > 0 && (
          <button type="button" className="m-button is-ghost is-small" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
