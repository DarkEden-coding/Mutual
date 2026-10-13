/** "Recent events" kept in localStorage on this device. */
import { useSyncExternalStore } from 'react';

export interface RecentEvent {
  id: string;
  title: string;
  lastVisited: number;
  isAdmin: boolean;
}

const KEY = 'mutual.recent';
const MAX = 30;
const listeners = new Set<() => void>();
let cache: RecentEvent[] | null = null;

function read(): RecentEvent[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    cache = Array.isArray(raw)
      ? raw.filter((r): r is RecentEvent => r && typeof r.id === 'string' && typeof r.title === 'string')
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: RecentEvent[]) {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export function getRecent(): RecentEvent[] {
  return read();
}

export function recordVisit(entry: { id: string; title: string; isAdmin: boolean }) {
  const list = read();
  const prev = list.find((r) => r.id === entry.id);
  const next: RecentEvent = {
    id: entry.id,
    title: entry.title,
    isAdmin: entry.isAdmin || !!prev?.isAdmin,
    lastVisited: Date.now(),
  };
  write([next, ...list.filter((r) => r.id !== entry.id)].slice(0, MAX));
}

export function removeRecent(id: string) {
  write(read().filter((r) => r.id !== id));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useRecentEvents(): RecentEvent[] {
  return useSyncExternalStore(subscribe, read, read);
}
