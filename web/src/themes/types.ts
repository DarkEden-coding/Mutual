export type ThemeGroup = 'classic' | 'eccentric';
export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedMode = 'light' | 'dark';

/** Four colours used to draw the mini preview card in the theme picker. */
export interface Swatch {
  bg: string;
  surface: string;
  text: string;
  accent: string;
}

/**
 * Per-theme metadata. Lives in `<id>/meta.ts` so a theme author can tune
 * their own picker preview without touching anything outside their folder.
 */
export interface ThemeMeta {
  id: string;
  name: string;
  group: ThemeGroup;
  description: string;
  swatch: { light: Swatch; dark: Swatch };
}
