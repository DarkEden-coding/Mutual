# Theming Mutual

Markup and layout are shared. A theme is **CSS only**: it overrides design tokens and may add decoration through documented class hooks. Themes must never require TSX changes.

## How it works

- `<html data-theme="<id>" data-mode="light|dark">`. Mode "system" resolves via `matchMedia` and updates live. State is persisted in `localStorage["mutual.theme"]` as `{theme, mode}`. `public/theme-boot.js` (loaded synchronously from `index.html`) applies it before first paint.
- `src/styles/tokens.css` defines every token with `minimal` defaults, inside `:where()` (zero specificity), so any theme selector wins regardless of load order. Tokens a theme does not override fall back to minimal.
- Each theme lives in `src/themes/<id>/` and owns exactly two files:
  - `theme.css` — all rules, scoped under `[data-theme="<id>"]` (light) and `[data-theme="<id>"][data-mode="dark"]` (dark).
  - `meta.ts` — display name, group, description and picker swatch colors (`light` and `dark`: `bg`, `surface`, `text`, `accent`).
- `src/themes/registry.ts` is central (do not edit). It lazy-loads `theme.css`; `minimal` is imported eagerly.
- Preview your work at `/themes` (dev server only): every component plus sample grids with fake data, and a theme and mode switcher. No backend needed.

## Tokens (all defined in `src/styles/tokens.css`)

Surfaces and text
- `--bg` page background; `--surface` cards, inputs; `--surface-2` subtle fills, hovers, segmented track; `--elevated` dialogs, popovers; `--overlay` dialog backdrop.
- `--text`, `--text-muted`, `--text-faint` (hints/placeholders; keep >= 3:1).
- `--border` hairlines; `--border-strong` inputs and emphasized edges.

Accent and status
- `--accent`, `--accent-hover`, `--accent-contrast` (text on accent), `--accent-soft` (tinted fill).
- `--danger`, `--danger-soft`, `--success`, `--success-soft`, `--warning`, `--warning-soft`.
- `--focus-ring` (color), `--ring-width`, `--ring-offset`.
- `--selection-bg` text selection; `--highlight`, `--highlight-soft` best-time and person highlight outline and fill.

Shape and depth
- `--radius-sm|md|lg|pill`, `--border-width`, `--shadow-sm|md|lg`.
- `--control-h`, `--control-h-sm` control heights (keep >= 2.5rem / 2rem for touch).
- `--backdrop` full `backdrop-filter` value for cards, header and popovers (`none` by default; glass sets `blur(...) saturate(...)`). Never set it to `blur(0)`: any non-none value creates a containing block.
- `--bg-image` background layer(s) under `--bg` on the page (e.g. gradients, textures). Must be valid before a trailing color, e.g. `linear-gradient(...)` or `none`. Do not put a `/ size` inside it; use `--bg-size`.
- `--bg-size` (default `auto`) `background-size` for `--bg-image`, one value per layer for tiled textures (e.g. `18px 18px`, or `auto, auto, 37px 41px`).

Role tokens (all optional; each defaults to an existing token, so only set them where a theme differs)
- `--field-bg` (default `--surface`): `.m-input`, `.m-select`, `.m-textarea`, `.m-input-group`.
- `--grid-surface` (default `--surface`): `.m-grid-wrap`, `.m-grid-corner`, `.m-grid-colhead`, `.m-grid-rowhead`. Keep it opaque (sticky row labels sit over cells).
- `--text-on-bg`, `--text-muted-on-bg` (default `--text`, `--text-muted`): text sitting directly on the page background, not inside a card: hero, event title/description/timezone row, panel titles, toolbar labels, ghost buttons in toolbars, grid hints, legends, tabs, empty/error states, footer. Set these when `--bg` has a different luminance from `--surface` (e.g. retro-os white on the teal desktop).
- `--tooltip-bg` (default `--elevated`), `--tooltip-text` (default `--text`), `--tooltip-border` (default `--border`): `.m-tooltip`, the heatmap hover card (a themed popover, not an inverted bubble). Most themes need no override; set them only for a deliberate look (retro-os yellow tip, sketchbook sticky note). Keep text >= 4.5:1 in both modes; the border width is `--border-width`; it also uses `--radius-md`, `--shadow-md`, `--backdrop` and body font.

Typography
- `--font-body`, `--font-heading`, `--font-mono`; `--weight-regular|medium|semibold|bold`, `--weight-heading`.
- `--heading-tracking`, `--heading-transform`, `--body-tracking`.
- `--text-xs|sm|base|md|lg|xl|2xl|3xl` size scale; `--space-1..8` spacing scale.
- `--content-width`, `--header-h`.

Motion
- `--dur-fast|base|slow`, `--ease-out`, `--ease-in-out`, `--ease-spring`.

Availability grid
- Editable cells: `--cell-empty`, `--cell-available`, `--cell-ifneeded`, `--cell-ifneeded-pattern` (image overlay so If-needed is not color-only), `--cell-disabled`, `--cell-disabled-pattern` (hatch for non-slots), `--cell-hover`.
- Lines: `--cell-border` (also the grid gap color), `--cell-border-strong` (hour lines), `--cell-gap`, `--cell-radius`, `--grid-radius`.
- Heatmap: `--heat-empty` (0 people), optional `--heat-mid`, `--heat-full` (everyone). A 3-stop ramp: empty to mid over `--heat` 0..0.5, mid to full over 0.5..1. `--heat-mid` defaults to `color-mix(in oklab, var(--heat-full) 50%, var(--heat-empty))` (a plain 2-stop ramp); set a vivid color when the default midpoint looks muddy (typically dark mode, e.g. dark gray to pale green). The legend bar uses the same three stops.
- Sizing: `--rowhead-w`, `--col-min-w` (row height is set per slot size via `--row-h` on `.m-grid`).

## Class hooks

Shell: `.m-app` (root; put page background art here), `.m-header`, `.m-header-inner`, `.m-brand`, `.m-brand-mark`, `.m-brand-name`, `.m-header-actions`, `.m-main`, `.m-footer`, `.m-page`.

Surfaces: `.m-card` (+ `.m-card-header`, `.m-card-title`, `.m-card-sub`, `.m-card-body`), `.m-banner` (`.is-success`, `.is-danger`, `.m-banner-title`), `.m-state` (empty/error screens), `.m-hero`.

Controls: `.m-button` (`.is-primary`, `.is-ghost`, `.is-danger`, `.is-small`, `.is-icon`, `.is-block`), `.m-input`, `.m-textarea`, `.m-select`, `.m-input-group` + `.m-input-prefix`, `.m-field`, `.m-label`, `.m-hint`, `.m-error`, `.m-ok`, `.m-segmented` + `.m-segmented-option(.is-active)`, `.m-tabs` + `.m-tab(.is-active)`, `.m-chip(.is-active)` + `.m-chip-row`, `.m-badge` (`.is-accent|success|warning|danger`), `.m-swatch-dot` (`.is-available|is-ifneeded`).

Overlays: `.m-dialog` (native `<dialog>`; `.m-dialog-header|title|body|footer`, `.m-dialog-footer.is-sticky` (pinned inside a long scrolling dialog body), `::backdrop`), `.m-popover`, `.m-theme-picker` (portalled to `<body>`, `position: fixed`, positioned inline under its trigger, so `--backdrop` blurs the real page; it is outside `.m-app`), `.m-theme-card(.is-active)`, `.m-theme-preview`, `.m-combobox`, `.m-combobox-list`, `.m-combobox-option(.is-active)`, `.m-tooltip` (heatmap hover card; portal to body; fixed; see Tooltip below), `.m-toast-region` + `.m-toast(.is-error|.is-success)`.

Calendar: `.m-calendar`, `.m-calendar-header`, `.m-calendar-title`, `.m-calendar-weekdays`, `.m-calendar-days`, `.m-calendar-day` (`.is-selected`, `.is-today`, `.is-disabled`, `.is-preview`, `.is-preview-remove`).

Grids: `.m-grid-wrap` (scroller, border; a theme may restyle it as a padded well, e.g. neumorphic, as long as `.m-grid-rowhead`/`.m-grid-corner` sticky `left` matches its padding) > `.m-grid` (`.is-readonly`, `.is-painting`) containing `.m-grid-corner`, `.m-grid-colhead` (`-day`, `-date`), `.m-grid-rowhead`, `.m-grid-gap` (time gap row), and cells:
- `.m-cell` (`.is-available`, `.is-ifneeded`, `.is-disabled`, `.is-preview`, `.is-hour-start`) in the editable grid.
- `.m-heat-cell` (`.is-disabled`, `.is-hovered`, `.is-best`, `.is-dimmed`, `.is-person-available`, `.is-person-ifneeded`, `.is-hour-start`; intensity in `--heat` 0..1) in the group grid.
- `[data-variant="edit"|"heat"]` on `.m-grid-wrap` to target one grid.

Event page: `.m-event-head`, `.m-event-title`, `.m-event-desc`, `.m-event-tz`, `.m-event-layout`, `.m-panel` (transparent; head row, `.m-panel-controls` and `.m-panel-main`; on wide screens both panels share rows via subgrid so the two grids start at the same y), `.m-toolbar`, `.m-signed-in`, `.m-saved` (`.is-saving|saved|error|idle`), `.m-signin`, `.m-legend` (+ `-bar`, `-item`, `-swatch`), `.m-best-strip` (compact Best times row at the top of the Group availability controls row; contains `.m-best-label`, then either `.m-best-empty` (inline message when there are no good times) or `.m-best-scroll` > `.m-best`), `.m-best` (horizontal, non-wrapping list) + `.m-best-item(.is-active)` (a compact pill chip: `.m-best-rank`, `.m-best-when` "Tue 12:00-2:45 PM", `.m-best-meta` "4/4"; keep it about `--control-h-sm` tall, no fixed widths, `white-space: nowrap`), `.m-best-rank`, `.m-best-scroll[data-fade-start|data-fade-end]` (set while the strip overflows; the fade is a mask, themes should not override it). Hover/focus on a chip previews the block on the group grid; click pins it. The Responses card (`.m-responses`) now sits alone, full width, below the grids. `.m-participants` + `.m-participant(.is-me|.is-active)`, `.m-copy-row`.

Home: `.m-home-grid`, `.m-form`, `.m-form-row`, `.m-when-grid` (+ `.m-when-days`, `.m-when-times`: calendar and hours/slot/timezone side by side on wide screens), `.m-recent-list`, `.m-recent-item`, `.m-recent-link`.

Tooltip (heatmap hover card, portal to `<body>`, `position: fixed`, placed beside the hovered cell and never over it; flips right / left / above / below and clamps to the viewport; max width 20rem). Hooks: `.m-tooltip` (`.is-pinned` after click/tap: `pointer-events: auto`, scrolls when long) containing `.m-tooltip-title` (day/date and time), `.m-tooltip-summary` ("N/M available (k if needed)") and `.m-roster` with `.m-roster-group` (`.is-available|is-ifneeded|is-unavailable`) > `.m-roster-heading` (`.m-roster-dot`, label, `.m-roster-count`) + `.m-roster-names` > `.m-roster-name(.is-unavailable)`. There is no separate roster card above the grid any more; `.m-roster*` only exist inside the tooltip, so keep them transparent (no card background, no extra border). Colors inherit from the tooltip. Screen readers get the same content from a polite live region next to the grid; the card itself is `aria-hidden`.

## Rules

1. Scope **every** selector under `[data-theme="<id>"]`. Dark variants under `[data-theme="<id>"][data-mode="dark"]`. Unscoped rules leak into all themes.
2. Edit only `src/themes/<id>/` (`theme.css`, `meta.ts`). Do not touch shared CSS, TSX, tokens or the registry.
3. Support both light and dark. Define every color token in both scopes (fall-through to minimal is a bug, not a fallback).
4. You may `@import url(...)` Google Fonts at the very top of `theme.css`.
5. Keep contrast accessible: body text >= 4.5:1, UI boundaries and focus ring >= 3:1, and available / if-needed / empty / disabled cells must be distinguishable (the pattern tokens exist so it is not color-only).
6. Do not break layout or hit areas: no `display`/`position` changes on structural classes, keep controls >= `--control-h-sm`, never remove focus outlines (restyle via `--focus-ring*`).
7. Components use only tokens; hard-coded colors belong only in theme files.
8. Respect reduced motion: wrap theme animations in `@media (prefers-reduced-motion: no-preference)`.
9. Prefer tokens first; use decoration (pseudo-elements, textures, borders) via class hooks second. Grid cells are numerous (thousands): keep per-cell effects cheap (no filters, no big shadows).

## Checklist

- [ ] Light and dark both look right at `/themes` (and `/` and an event page).
- [ ] All tokens overridden in both modes where the theme differs from minimal.
- [ ] Editable grid: empty / available / if-needed / disabled / preview clearly distinct.
- [ ] Heatmap ramp readable from `--heat-empty` to `--heat-full`; best-time and person highlights visible.
- [ ] Focus ring visible on every control, including grid cells.
- [ ] Works at 360px wide; dialogs and the theme popover fit.
- [ ] Text contrast checked (muted and faint text, text on accent).
- [ ] Animations gated by `prefers-reduced-motion`.
- [ ] `meta.ts` swatches match the theme and use real colors from it.
- [ ] No selector outside `[data-theme="<id>"]`.

## Notes for authors

- Non-minimal themes load lazily; the page is hidden (`data-theme-ready="0"`) until the CSS is in, then fades in.
- The page background is painted by `.m-app::after`: `position: fixed; inset: 0; z-index: -1` with `background: var(--bg-image) var(--bg)` and `background-size: var(--bg-size)`. It covers any scroll length, with no `background-attachment: fixed` seams. `.m-app::before` is free for theme overlays (terminal uses it). Never put `filter`, `transform`, `backdrop-filter`, `will-change` or `contain` on `.m-app` or its ancestors: that makes the fixed layer size to that element instead of the viewport (the same containing-block trap as a non-`none` `--backdrop`).
- Playwright `fullPage` screenshots keep fixed layers at viewport height, so a seam below the first screen in such a shot is a capture artifact; set the viewport height to the page height to check.
- Grid row labels live in `.m-grid-rowhead`; the gap between lines is the grid `background` (`--cell-border`) showing through `--cell-gap`.
