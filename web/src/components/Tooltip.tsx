import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 350;
const GAP = 8;
const EDGE = 8;

interface Props {
  /** Hint text. When empty, the child is rendered unchanged. */
  content?: ReactNode;
  /** A single element. Its own event handlers and aria-describedby are preserved. */
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}

/**
 * Hover / keyboard-focus hint for one control. It adds no wrapper element (the child is cloned
 * with extra handlers), so layouts and sibling selectors are unaffected. The bubble is portalled
 * to <body> and reuses `.m-tooltip`, so each theme styles it. Touch input does not show it.
 */
export function Tooltip({ content, children }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
    setOpen(false);
  };

  const show = (el: HTMLElement) => {
    anchorRef.current = el;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  };

  // Place the bubble above the anchor (below if there is no room), centred and kept inside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const r = anchor.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let top = r.top - GAP - h;
    if (top < EDGE) top = r.bottom + GAP;
    const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, EDGE), window.innerWidth - w - EDGE);
    setPos({ top, left });
  }, [open]);

  // Dismiss on Escape, and on scroll or resize (the bubble would otherwise drift from its anchor).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!content) return children;

  const child = children;
  const { props } = child;
  const trigger = {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      props.onPointerEnter?.(e);
      if (e.pointerType === 'mouse') show(e.currentTarget);
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      props.onPointerLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      props.onFocus?.(e);
      if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      props.onBlur?.(e);
      hide();
    },
    'aria-describedby': open ? id : props['aria-describedby'],
  };

  return (
    <>
      {cloneElement(child, trigger)}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="m-tooltip is-hint"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
