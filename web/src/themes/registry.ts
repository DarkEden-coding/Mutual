import type { ThemeGroup, ThemeMeta } from './types';
import { meta as m0 } from './minimal/meta';
import { meta as m1 } from './neumorphic/meta';
import { meta as m2 } from './material/meta';
import { meta as m3 } from './glass/meta';
import { meta as m4 } from './nord/meta';
import { meta as m5 } from './paper/meta';
import { meta as m6 } from './retro-os/meta';
import { meta as m7 } from './terminal/meta';
import { meta as m8 } from './brutalist/meta';
import { meta as m9 } from './y2k/meta';
import { meta as m10 } from './sketchbook/meta';
import { meta as m11 } from './cottagecore/meta';
// `minimal` is imported eagerly: it is the default and the fallback for unknown ids.
import './minimal/theme.css';

export interface ThemeDef extends ThemeMeta {
  /** Lazy-loads the theme stylesheet (Vite injects it on resolve). */
  load: () => Promise<unknown>;
}

const loaders: Record<string, () => Promise<unknown>> = {
  minimal: () => Promise.resolve(),
  'neumorphic': () => import('./neumorphic/theme.css'),
  'material': () => import('./material/theme.css'),
  'glass': () => import('./glass/theme.css'),
  'nord': () => import('./nord/theme.css'),
  'paper': () => import('./paper/theme.css'),
  'retro-os': () => import('./retro-os/theme.css'),
  'terminal': () => import('./terminal/theme.css'),
  'brutalist': () => import('./brutalist/theme.css'),
  'y2k': () => import('./y2k/theme.css'),
  'sketchbook': () => import('./sketchbook/theme.css'),
  'cottagecore': () => import('./cottagecore/theme.css'),
};

const METAS: ThemeMeta[] = [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11];

export const THEMES: ThemeDef[] = METAS.map((m) => ({ ...m, load: loaders[m.id] }));

export const DEFAULT_THEME_ID = 'minimal';

export const THEME_GROUPS: { id: ThemeGroup; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'eccentric', label: 'Eccentric' },
];

export function getTheme(id: string): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id);
}
