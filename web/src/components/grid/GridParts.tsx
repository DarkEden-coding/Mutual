import type { CSSProperties, KeyboardEvent } from 'react';
import type { ViewGrid } from '../../lib/slots';

export function gridStyle(view: ViewGrid): CSSProperties {
  const rowH = view.slotMinutes >= 60 ? '2.5rem' : view.slotMinutes >= 30 ? '1.875rem' : '1.5rem';
  return {
    gridTemplateColumns: `var(--rowhead-w) repeat(${view.cols}, minmax(var(--col-min-w), 1fr))`,
    ['--row-h' as string]: rowH,
  };
}

export function GridHeads({ view }: { view: ViewGrid }) {
  return (
    <>
      <div className="m-grid-corner" role="presentation" />
      {view.columns.map((c) => (
        <div key={c.key} className="m-grid-colhead" role="columnheader" aria-label={c.fullLabel}>
          <span className="m-grid-colhead-day">{c.label}</span>
          {c.sublabel && <span className="m-grid-colhead-date">{c.sublabel}</span>}
        </div>
      ))}
    </>
  );
}

/** Locate the grid cell (row/col) containing a DOM node or point. */
export function cellFromNode(node: Element | null): { row: number; col: number } | null {
  const el = node?.closest<HTMLElement>('[data-r]');
  if (!el) return null;
  return { row: Number(el.dataset.r), col: Number(el.dataset.c) };
}

export function cellFromPoint(x: number, y: number) {
  return cellFromNode(document.elementFromPoint(x, y));
}

export function sameCell(a: { row: number; col: number } | null, b: { row: number; col: number } | null) {
  return a === b || (!!a && !!b && a.row === b.row && a.col === b.col);
}

/** Arrow/Home/End navigation shared by both grids. Returns the new cell or null. */
export function arrowTarget(
  e: KeyboardEvent,
  view: ViewGrid,
  cur: { row: number; col: number },
): { row: number; col: number } | null {
  let { row, col } = cur;
  switch (e.key) {
    case 'ArrowUp':
      row--;
      break;
    case 'ArrowDown':
      row++;
      break;
    case 'ArrowLeft':
      col--;
      break;
    case 'ArrowRight':
      col++;
      break;
    case 'Home':
      col = 0;
      break;
    case 'End':
      col = view.cols - 1;
      break;
    case 'PageUp':
      row = 0;
      break;
    case 'PageDown':
      row = view.nrows - 1;
      break;
    default:
      return null;
  }
  row = Math.max(0, Math.min(view.nrows - 1, row));
  col = Math.max(0, Math.min(view.cols - 1, col));
  return { row, col };
}

export function focusCell(root: HTMLElement | null, row: number, col: number) {
  root?.querySelector<HTMLElement>(`[data-r="${row}"][data-c="${col}"]`)?.focus();
}

export function firstEnabledCell(view: ViewGrid): { row: number; col: number } {
  for (let i = 0; i < view.cells.length; i++) {
    if (view.cells[i] >= 0) return { row: Math.floor(i / view.cols), col: i % view.cols };
  }
  return { row: 0, col: 0 };
}
