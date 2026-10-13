interface Props<T extends string> {
  value: T;
  tabs: { id: T; label: string }[];
  onChange: (id: T) => void;
  label: string;
  idPrefix: string;
}

export function Tabs<T extends string>({ value, tabs, onChange, label, idPrefix }: Props<T>) {
  return (
    <div
      className="m-tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const i = tabs.findIndex((t) => t.id === value);
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        onChange(next.id);
        const root = e.currentTarget;
        requestAnimationFrame(() => root.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={t.id === value}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={t.id === value ? 0 : -1}
          className={`m-tab${t.id === value ? ' is-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
