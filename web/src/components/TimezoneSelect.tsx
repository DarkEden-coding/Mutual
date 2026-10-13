import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { listTimeZones, offsetLabel, prettyZoneName } from '../lib/tz';
import { useDismiss } from '../hooks/useClickOutside';
import { IconChevronDown } from './Icons';

interface Props {
  value: string;
  onChange: (tz: string) => void;
  id?: string;
  label?: string;
  compact?: boolean;
  openUp?: boolean;
}

let zonesCache: { name: string; hay: string; offset: string }[] | null = null;
function zones() {
  if (!zonesCache) {
    zonesCache = listTimeZones().map((name) => ({
      name,
      hay: prettyZoneName(name).toLowerCase() + ' ' + name.toLowerCase(),
      offset: offsetLabel(name),
    }));
  }
  return zonesCache;
}

/** Searchable IANA timezone combobox (ARIA 1.2 select-only pattern with filtering). */
export function TimezoneSelect({ value, onChange, id, label = 'Timezone', compact, openUp }: Props) {
  const reactId = useId();
  const inputId = id ?? `${reactId}-input`;
  const listId = `${reactId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);
  useDismiss(wrapRef, open, close);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[_/]+/g, ' ');
    const all = zones();
    if (!q) return all;
    const terms = q.split(/\s+/);
    return all.filter((z) => terms.every((t) => z.hay.includes(t) || z.offset.toLowerCase().includes(t)));
  }, [query]);

  const choose = (name: string) => {
    onChange(name);
    close();
  };

  const scrollTo = (i: number) => {
    requestAnimationFrame(() => listRef.current?.children[i]?.scrollIntoView({ block: 'nearest' }));
  };

  const openList = () => {
    if (open) return;
    setOpen(true);
    const idx = zones().findIndex((z) => z.name === value);
    setActive(Math.max(0, idx));
    scrollTo(Math.max(0, idx));
  };

  const shown = open ? query : prettyZoneName(value);

  return (
    <div className={`m-combobox${compact ? ' is-compact' : ''}`} ref={wrapRef}>
      <input
        id={inputId}
        className="m-input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={shown}
        placeholder={open ? 'Search cities or zones' : undefined}
        onFocus={openList}
        onClick={openList}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) return openList();
            const n = Math.min(results.length - 1, active + 1);
            setActive(n);
            scrollTo(n);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const n = Math.max(0, active - 1);
            setActive(n);
            scrollTo(n);
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            if (results[active]) choose(results[active].name);
          } else if (e.key === 'Tab') {
            close();
          }
        }}
      />
      <span className="m-combobox-chevron">
        <IconChevronDown size={16} />
      </span>
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label={`${label} options`} className={`m-combobox-list${openUp ? ' is-up' : ''}`}>
          {results.length === 0 && <li className="m-combobox-empty">No matching timezone</li>}
          {results.slice(0, 400).map((z, i) => (
            <li
              key={z.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={z.name === value}
              className={`m-combobox-option${i === active ? ' is-active' : ''}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(z.name)}
              onMouseMove={() => i !== active && setActive(i)}
            >
              <span>{prettyZoneName(z.name)}</span>
              <span className="m-combobox-meta">{z.offset}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
