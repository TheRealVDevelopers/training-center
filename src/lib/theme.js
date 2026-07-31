// Day / night theme. The whole app is styled through CSS custom properties,
// so switching = stamping data-theme on <html>. Remembered per device.
const KEY = 'tc_theme'

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'dark' } catch { return 'dark' }
}

export function setTheme(t) {
  try { localStorage.setItem(KEY, t) } catch { /* private mode */ }
  document.documentElement.dataset.theme = t
}

export function initTheme() {
  document.documentElement.dataset.theme = getTheme()
}
