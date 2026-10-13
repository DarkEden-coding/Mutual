// Pre-paint theme bootstrap: avoids a flash of the wrong theme/mode.
// Keep in sync with src/themes/store.ts (storage key + shape).
(function () {
  var d = document.documentElement;
  var theme = 'minimal', mode = 'system';
  try {
    var raw = localStorage.getItem('mutual.theme');
    if (raw) {
      var s = JSON.parse(raw);
      if (s && typeof s.theme === 'string' && /^[a-z0-9-]+$/.test(s.theme)) theme = s.theme;
      if (s && (s.mode === 'light' || s.mode === 'dark' || s.mode === 'system')) mode = s.mode;
    }
  } catch (e) {}
  var dark = mode === 'dark' || (mode === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  d.setAttribute('data-theme', theme);
  d.setAttribute('data-mode', dark ? 'dark' : 'light');
  // Non-minimal themes are lazy CSS: hide until loaded (see src/themes/store.ts).
  d.setAttribute('data-theme-ready', theme === 'minimal' ? '1' : '0');
  if (theme !== 'minimal') setTimeout(function () { d.setAttribute('data-theme-ready', '1'); }, 3000);
})();
