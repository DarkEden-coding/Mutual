import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconX } from './Icons';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Modal built on the native <dialog>: focus trap, Esc to close, inert background. */
export function Dialog({ open, title, onClose, children, footer, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`m-dialog${wide ? ' is-wide' : ''}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="m-dialog-header">
            <h2 id={titleId} className="m-dialog-title">
              {title}
            </h2>
            <button type="button" className="m-button is-ghost is-icon is-small" aria-label="Close" onClick={onClose}>
              <IconX />
            </button>
          </div>
          <div className="m-dialog-body">{children}</div>
          {footer && <div className="m-dialog-footer">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
