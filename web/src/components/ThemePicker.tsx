import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { THEMES, THEME_GROUPS } from '../themes/registry';
import { setMode, setTheme, useThemeState } from '../themes/store';
import type { ThemeMode } from '../themes/types';
import { IconPalette } from './Icons';
import { Segmented } from './Segmented';

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/** Theme + mode controls, used inside the popover and on the kitchen-sink page. */
export function ThemeControls() {
  const { theme, mode, resolvedMode } = useThemeState();
  return (
    <>
      <Segmented<ThemeMode> label="Color mode" value={mode} options={MODES} onChange={setMode} block />
      {THEME_GROUPS.map((g) => (
        <section key={g.id} aria-label={`${g.label} themes`}>
          <h3 className="m-theme-group-title">{g.label}</h3>
          <div className="m-theme-grid">
            {THEMES.filter((t) => t.group === g.id).map((t) => {
              const sw = t.swatch[resolvedMode];
              const active = t.id === theme;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`m-theme-card${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  title={t.description}
                  data-theme-id={t.id}
                  onClick={() => void setTheme(t.id)}
                >
                  <span className="m-theme-preview" style={{ background: sw.bg }}>
                    <span className="m-theme-preview-surface" style={{ background: sw.surface }} />
                    <span className="m-theme-preview-lines">
                      <i style={{ background: sw.text, width: '100%' }} />
                      <i style={{ background: sw.text, width: '60%' }} />
                    </span>
                    <span className="m-theme-preview-accent" style={{ background: sw.accent }} />
                  </span>
                  <span className="m-theme-name">{t.name}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

const TABBABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const EDGE = 8; // px kept clear of the viewport edge
const GAP = 8; // px between trigger and popover

interface PopoverPos {
  top: number;
  left: number;
  maxHeight: number;
}

/**
 * Theme popover. Rendered through a portal to document.body (so its backdrop-filter sees the
 * page rather than nesting inside the header's backdrop) and positioned fixed under the trigger.
 */
export function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const width = popRef.current?.offsetWidth ?? 0;
    const vw = document.documentElement.clientWidth;
    const top = Math.round(r.bottom + GAP);
    const left = Math.round(Math.max(EDGE, Math.min(r.right - width, vw - width - EDGE)));
    const maxHeight = Math.max(160, window.innerHeight - top - EDGE);
    setPos((cur) => (cur && cur.top === top && cur.left === left && cur.maxHeight === maxHeight ? cur : { top, left, maxHeight }));
  }, []);

  // Position before paint, then track resize / scroll (any scroller) / popover size changes.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const pop = popRef.current;
    const ro = pop && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (pop) ro?.observe(pop);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      ro?.disconnect();
    };
  }, [open, place]);

  // Move focus into the popover on open.
  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLElement>(TABBABLE)?.focus();
  }, [open]);

  // Outside pointerdown closes (focus stays where the user clicked); Escape closes and returns focus.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open, close]);

  // The popover lives at the end of <body>, so tab order must hand focus back and forth by hand.
  const onPopoverKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const items = Array.from(popRef.current?.querySelectorAll<HTMLElement>(TABBABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if ((e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
      e.preventDefault();
      close(true);
    }
  };
  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (open && e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      popRef.current?.querySelector<HTMLElement>(TABBABLE)?.focus();
    }
  };

  return (
    <div className="m-popover-anchor">
      <button
        ref={triggerRef}
        type="button"
        className="m-button is-ghost is-small"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        <IconPalette />
        <span>Theme</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={id}
            className="m-popover m-theme-picker"
            role="dialog"
            aria-label="Theme and color mode"
            onKeyDown={onPopoverKeyDown}
            style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { top: 0, left: 0, visibility: 'hidden' }}
          >
            <ThemeControls />
          </div>,
          document.body,
        )}
    </div>
  );
}
