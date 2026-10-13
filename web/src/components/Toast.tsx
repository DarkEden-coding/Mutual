import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setItems((cur) => [...cur.slice(-2), { id, text, kind }]);
    window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 2800);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="m-toast-region" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`m-toast${t.kind === 'info' ? '' : ` is-${t.kind}`}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
