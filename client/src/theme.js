export const THEME_KEY = 'bbms_theme';

/**
 * Detect stored theme or fallback to system preference
 */
export function getPreferredTheme() {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Fallback if localStorage or matchMedia is restricted
  }
  return 'light';
}

/**
 * Apply theme to document element and persist in localStorage
 */
export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const targetTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', targetTheme);
  try {
    window.localStorage.setItem(THEME_KEY, targetTheme);
  } catch {
    // Ignore storage errors in test or restricted environments
  }
  return targetTheme;
}

/**
 * Initialize theme at page load
 */
export function initTheme() {
  const theme = getPreferredTheme();
  applyTheme(theme);
  return theme;
}
