import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';

interface Option<T extends string | number> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
  /** Hover / focus hint explaining what the option does. */
  tip?: ReactNode;
}

interface Props<T extends string | number> {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  label: string;
  block?: boolean;
  className?: string;
}

export function Segmented<T extends string | number>({ value, options, onChange, label, block, className }: Props<T>) {
  return (
    <div
      className={`m-segmented${block ? ' is-block' : ''}${className ? ` ${className}` : ''}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = options.findIndex((o) => o.value === value);
        const n = options.length;
        const next = options[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n];
        onChange(next.value);
        const root = e.currentTarget;
        requestAnimationFrame(() => root.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
      }}
    >
      {options.map((o) => (
        <Tooltip key={String(o.value)} content={o.tip}>
          <button
            type="button"
            role="radio"
            aria-checked={o.value === value}
            aria-label={o.ariaLabel}
            tabIndex={o.value === value ? 0 : -1}
            className={`m-segmented-option${o.value === value ? ' is-active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
