/**
 * Display preferences: text size, reading size, line spacing and theme.
 *
 * Everything is applied through CSS custom properties on `<html>`, so a
 * preference set on a phone in the exam hall survives to the next question
 * without any component re-rendering or knowing about it. The values are
 * stored per browser (localStorage) because they describe the device and the
 * reader's eyes, not the account.
 *
 * The reading controls matter most on a phone: a candidate must be able to make
 * a passage comfortable to read without pinch-zooming (which the exam shell
 * cannot observe anyway) or leaving the test.
 */

export const FONT_SCALES = ['compact', 'normal', 'large', 'xlarge'] as const;
export type FontScale = (typeof FONT_SCALES)[number];

export const FONT_SCALE_LABELS: Record<FontScale, string> = {
  compact: 'Nhỏ',
  normal: 'Vừa',
  large: 'Lớn',
  xlarge: 'Rất lớn',
};

/**
 * Root font size in px per scale. 14px is the design default: the interface was
 * 15.5px and read as oversized next to the amount of content on each screen, so
 * every step moved down by one notch (a stored "Vừa" now means 14px).
 */
export const FONT_SCALE_PX: Record<FontScale, number> = {
  compact: 13,
  normal: 14,
  large: 16,
  xlarge: 18,
};

export type ThemePreference = 'system' | 'light' | 'dark';

export interface DisplayPrefs {
  fontScale: FontScale;
  /** Multiplier for passage/reading text only (1 = 1rem). */
  readingScale: number;
  /** Line height for reading text. */
  readingLeading: number;
  /** Extra letter spacing for reading text, in em. */
  readingSpacing: number;
  theme: ThemePreference;
  /** Widen the reading column for long passages on a big screen. */
  wideReading: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_PREFS: DisplayPrefs = {
  fontScale: 'normal',
  readingScale: 1,
  readingLeading: 1.75,
  readingSpacing: 0,
  theme: 'system',
  wideReading: false,
  reduceMotion: false,
};

const STORAGE_KEY = 'aieo.display.v1';

export function loadPrefs(): DisplayPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<DisplayPrefs>;
    return sanitisePrefs(parsed);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function sanitisePrefs(input: Partial<DisplayPrefs>): DisplayPrefs {
  const fontScale = FONT_SCALES.includes(input.fontScale as FontScale)
    ? (input.fontScale as FontScale)
    : DEFAULT_PREFS.fontScale;
  return {
    fontScale,
    readingScale: clamp(input.readingScale ?? DEFAULT_PREFS.readingScale, 0.85, 1.8),
    readingLeading: clamp(input.readingLeading ?? DEFAULT_PREFS.readingLeading, 1.4, 2.4),
    readingSpacing: clamp(input.readingSpacing ?? DEFAULT_PREFS.readingSpacing, 0, 0.08),
    theme: input.theme === 'light' || input.theme === 'dark' ? input.theme : 'system',
    wideReading: input.wideReading === true,
    reduceMotion: input.reduceMotion === true,
  };
}

export function savePrefs(prefs: DisplayPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode: the preferences still apply for this session.
  }
}

/** Writes the preferences onto `<html>` as CSS variables + a theme attribute. */
export function applyPrefs(prefs: DisplayPrefs): void {
  const root = document.documentElement;
  const scale = FONT_SCALE_PX[prefs.fontScale];
  root.style.setProperty('--ui-font-size', `${scale}px`);
  root.style.setProperty('--reading-scale', String(prefs.readingScale));
  root.style.setProperty('--reading-leading', String(prefs.readingLeading));
  root.style.setProperty('--reading-spacing', `${prefs.readingSpacing}em`);
  root.dataset.theme = prefs.theme === 'system' ? resolveSystemTheme() : prefs.theme;
  root.dataset.readingWidth = prefs.wideReading ? 'wide' : 'normal';
  root.dataset.reduceMotion = prefs.reduceMotion ? 'true' : 'false';
}

function resolveSystemTheme(): 'light' | 'dark' {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Subscribes to the OS theme while the preference is `system`. */
export function watchSystemTheme(onChange: (theme: 'light' | 'dark') => void): () => void {
  try {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => onChange(event.matches ? 'dark' : 'light');
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  } catch {
    return () => undefined;
  }
}

/** True when the device is a phone-sized touch device (portrait or landscape). */
export function isPhoneViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 720;
}

export function isPortrait(): boolean {
  return typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
}
