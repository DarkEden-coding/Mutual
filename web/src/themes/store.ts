/**
 * Theme + mode state. Mirrors what public/theme-boot.js does before paint:
 *   <html data-theme="<id>" data-mode="light|dark" data-theme-ready="0|1">
 * Persisted as JSON {theme, mode} under localStorage["mutual.theme"].
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_THEME_ID, getTheme } from './registry';
import type { ResolvedMode, ThemeMode } from './types';

const KEY = 'mutual.theme';

export interface ThemeState {
  theme: string;
  mode: ThemeMode;
  resolvedMode: ResolvedMode;
}

const mql: MediaQueryList | null =
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolve(mode: ThemeMode): ResolvedMode {
  if (mode === 'system') return mql?.matches ? 'dark' : 'light';
  return mode;
}

function readStored(): { theme: string; mode: ThemeMode } {
  let theme = DEFAULT_THEME_ID;
  let mode: ThemeMode = 'system';
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s.theme === 'string' && getTheme(s.theme)) theme = s.theme;
    if (s && (s.mode === 'light' || s.mode === 'dark' || s.mode === 'system')) mode = s.mode;
  } catch {
    /* ignore */
  }
  return { theme, mode };
}

let state: ThemeState = (() => {
  const s = readStored();
  return { ...s, resolvedMode: resolve(s.mode) };
})();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function applyAttrs(s: ThemeState) {
  const root = document.documentElement;
  root.setAttribute('data-theme', s.theme);
  root.setAttribute('data-mode', s.resolvedMode);
  root.setAttribute('data-theme-ready', '1');
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ theme: state.theme, mode: state.mode }));
  } catch {
    /* ignore */
  }
}

async function loadCss(id: string) {
  try {
    await getTheme(id)?.load();
  } catch {
    /* stylesheet failed to load: token defaults (minimal) still apply */
  }
}

/** Call once at startup: loads the active theme's CSS, then reveals the page. */
export async function initTheme() {
  await loadCss(state.theme);
  applyAttrs(state);
  mql?.addEventListener('change', () => {
    if (state.mode !== 'system') return;
    state = { ...state, resolvedMode: resolve('system') };
    applyAttrs(state);
    emit();
  });
}

export async function setTheme(id: string) {
  if (!getTheme(id) || id === state.theme) return;
  await loadCss(id); // load before applying so there is no unstyled frame
  state = { ...state, theme: id };
  applyAttrs(state);
  persist();
  emit();
}

export function setMode(mode: ThemeMode) {
  state = { ...state, mode, resolvedMode: resolve(mode) };
  applyAttrs(state);
  persist();
  emit();
}

export function getThemeState(): ThemeState {
  return state;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useThemeState(): ThemeState {
  return useSyncExternalStore(subscribe, getThemeState, getThemeState);
}
