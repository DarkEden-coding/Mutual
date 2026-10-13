import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { paintRect, strokeValue, type SlotValue, type ViewGrid } from '../../lib/slots';
import {
  GridHeads,
  arrowTarget,
  cellFromNode,
  cellFromPoint,
  firstEnabledCell,
  focusCell,
  gridStyle,
  sameCell,
} from './GridParts';

interface Props {
  view: ViewGrid;
  value: string;
  onChange: (next: string) => void;
  brush: '1' | '2';
  disabled?: boolean;
  ariaLabel: string;
}

interface Drag {
  anchor: { row: number; col: number };
  cur: { row: number; col: number };
  stroke: SlotValue;
  base: string;
}

const TOUCH_HOLD_MS = 150;
const TOUCH_SLOP = 8;
const STATE_WORD: Record<string, string> = { '0': 'unavailable', '1': 'available', '2': 'if needed' };

interface RowProps {
  view: ViewGrid;
  r: number;
  keyStr: string;
}

/** Key chars: '-' disabled, '0' '1' '2' value, 'a' 'b' 'c' value inside the drag preview; ',' + col = focus marker. */
const Row = memo(function Row({ view, r, keyStr }: RowProps) {
  const row = view.rows[r];
  const [chars, focusPart] = keyStr.split(',');
  const focusCol = focusPart === undefined ? -1 : Number(focusPart);
  const hour = r > 0 && row.minute % 60 === 0;
  return (
    <>
      {row.gapBefore && <div className="m-grid-gap" role="presentation" />}
      <div className="m-grid-rowhead" role="rowheader">
        {row.showLabel ? row.label : ''}
      </div>
      {Array.from(chars, (ch, c) => {
        const disabled = ch === '-';
        const preview = ch >= 'a' && ch <= 'c';
        const v = preview ? String.fromCharCode(ch.charCodeAt(0) - 49) : ch;
        const cls = [
          'm-cell',
          disabled && 'is-disabled',
          v === '1' && 'is-available',
          v === '2' && 'is-ifneeded',
          preview && 'is-preview',
          hour && 'is-hour-start',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={c}
            className={cls}
            role="gridcell"
            data-r={r}
            data-c={c}
            tabIndex={c === focusCol ? 0 : -1}
            aria-disabled={disabled || undefined}
            aria-label={
              disabled ? undefined : `${view.columns[c].fullLabel}, ${row.label}: ${STATE_WORD[v] ?? 'unavailable'}`
            }
          />
        );
      })}
    </>
  );
});

export function EditGrid({ view, value, onChange, brush, disabled, ariaLabel }: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [focus, setFocus] = useState(() => firstEnabledCell(view));
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const latest = useRef({ view, value, onChange, brush, disabled });
  latest.current = { view, value, onChange, brush, disabled };

  const startDrag = (cell: { row: number; col: number }, slot: number): Drag => {
    const { value: v, brush: b } = latest.current;
    const d: Drag = { anchor: cell, cur: cell, stroke: strokeValue(v[slot] ?? '0', b), base: v };
    dragRef.current = d;
    setDrag(d);
    return d;
  };

  const moveDrag = (cell: { row: number; col: number } | null) => {
    const d = dragRef.current;
    if (!d || !cell || sameCell(d.cur, cell)) return;
    dragRef.current = { ...d, cur: cell };
    setDrag(dragRef.current);
  };

  const endDrag = (commit: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (d && commit) {
      const { view: vw, onChange: change } = latest.current;
      const next = paintRect(d.base, vw, d.anchor, d.cur, d.stroke);
      if (next !== d.base) change(next);
    }
  };

  // ---- mouse / pen: pointer events ----
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      moveDrag(cellFromPoint(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      endDrag(true);
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') endDrag(false);
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
  }, [dragging]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.pointerType === 'touch' || e.button !== 0) return;
    const cell = cellFromNode(e.target as Element);
    if (!cell) return;
    const slot = view.cells[cell.row * view.cols + cell.col];
    if (slot < 0) return;
    e.preventDefault();
    setFocus(cell);
    startDrag(cell, slot);
  };

  // ---- touch: hold briefly then drag-paint (scroll is blocked only while painting); tap toggles ----
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    let timer: number | undefined;
    let startX = 0;
    let startY = 0;
    let startCell: { row: number; col: number } | null = null;
    let painting = false;

    const reset = () => {
      window.clearTimeout(timer);
      startCell = null;
      painting = false;
    };

    const slotOf = (c: { row: number; col: number }) => latest.current.view.cells[c.row * latest.current.view.cols + c.col];

    const onStart = (e: TouchEvent) => {
      if (latest.current.disabled || e.touches.length !== 1) return reset();
      const t = e.touches[0];
      const cell = cellFromNode(e.target as Element);
      if (!cell || slotOf(cell) < 0) return reset();
      startX = t.clientX;
      startY = t.clientY;
      startCell = cell;
      painting = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!startCell) return;
        painting = true;
        startDrag(startCell, slotOf(startCell));
        navigator.vibrate?.(8);
      }, TOUCH_HOLD_MS);
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!startCell) return;
      if (painting) {
        if (e.cancelable) e.preventDefault();
        moveDrag(cellFromPoint(t.clientX, t.clientY));
        return;
      }
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > TOUCH_SLOP) reset(); // user is scrolling
    };

    const onEnd = (e: TouchEvent) => {
      if (!startCell) return;
      if (painting) {
        if (e.cancelable) e.preventDefault();
        endDrag(true);
      } else {
        // quick tap: toggle a single cell
        window.clearTimeout(timer);
        const cell = startCell;
        const d = startDrag(cell, slotOf(cell));
        void d;
        endDrag(true);
        if (e.cancelable) e.preventDefault();
      }
      reset();
    };

    const onCancel = () => {
      if (painting) endDrag(false);
      reset();
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onCancel);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- keyboard ----
  const onKeyDown = (e: React.KeyboardEvent) => {
    const cell = cellFromNode(e.target as Element);
    if (!cell) return;
    const target = arrowTarget(e, view, cell);
    if (target) {
      e.preventDefault();
      setFocus(target);
      focusCell(gridRef.current, target.row, target.col);
      return;
    }
    if (disabled) return;
    const slot = view.cells[cell.row * view.cols + cell.col];
    if (slot < 0) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const stroke = strokeValue(value[slot] ?? '0', brush);
      onChange(paintRect(value, view, cell, cell, stroke));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onChange(paintRect(value, view, cell, cell, '0'));
    }
  };

  // ---- derive row keys ----
  const effective = useMemo(
    () => (drag ? paintRect(drag.base, view, drag.anchor, drag.cur, drag.stroke) : value),
    [drag, view, value],
  );
  const rect = drag
    ? {
        r0: Math.min(drag.anchor.row, drag.cur.row),
        r1: Math.max(drag.anchor.row, drag.cur.row),
        c0: Math.min(drag.anchor.col, drag.cur.col),
        c1: Math.max(drag.anchor.col, drag.cur.col),
      }
    : null;

  const rowKeys = useMemo(() => {
    const keys: string[] = [];
    for (let r = 0; r < view.nrows; r++) {
      let s = '';
      for (let c = 0; c < view.cols; c++) {
        const slot = view.cells[r * view.cols + c];
        if (slot < 0) {
          s += '-';
          continue;
        }
        let ch = effective[slot] ?? '0';
        if (rect && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1) {
          ch = String.fromCharCode(ch.charCodeAt(0) + 49);
        }
        s += ch;
      }
      if (focus.row === r) s += `,${focus.col}`;
      keys.push(s);
    }
    return keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, effective, rect?.r0, rect?.r1, rect?.c0, rect?.c1, focus.row, focus.col]);

  return (
    <div className="m-grid-wrap" data-variant="edit">
      <div
        ref={gridRef}
        className={`m-grid${disabled ? ' is-readonly' : ''}${drag ? ' is-painting' : ''}`}
        role="grid"
        aria-label={ariaLabel}
        aria-readonly={disabled || undefined}
        style={gridStyle(view)}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        <GridHeads view={view} />
        {rowKeys.map((k, r) => (
          <Row key={r} view={view} r={r} keyStr={k} />
        ))}
      </div>
    </div>
  );
}
