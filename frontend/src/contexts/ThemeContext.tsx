import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = Exclude<ThemePreference, 'system'>;
export type BackgroundKind = 'default' | 'solid' | 'gradient' | 'image';

export interface BackgroundPreference {
  kind: BackgroundKind;
  value: string;
}

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  background: BackgroundPreference;
  setTheme: (theme: ThemePreference) => void;
  setBackground: (background: BackgroundPreference) => void;
}

const THEME_STORAGE_KEY = 'academic-tasks-theme';
const BACKGROUND_STORAGE_KEY = 'academic-tasks-background';
const DEFAULT_BACKGROUND: BackgroundPreference = { kind: 'default', value: '' };
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storedTheme(): ThemePreference {
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function isSafeBackground(background: BackgroundPreference) {
  if (background.kind === 'default') return true;
  if (background.kind === 'solid') return /^#[0-9a-f]{6}$/i.test(background.value);
  if (background.kind === 'gradient') {
    return /^linear-gradient\(\d{1,3}deg,\s*#[0-9a-f]{6},\s*#[0-9a-f]{6}\)$/i.test(background.value);
  }
  return background.kind === 'image' && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(background.value);
}

function storedBackground(): BackgroundPreference {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BACKGROUND_STORAGE_KEY) || 'null') as BackgroundPreference | null;
    return parsed && isSafeBackground(parsed) ? parsed : DEFAULT_BACKGROUND;
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

function cssBackground(background: BackgroundPreference, resolvedTheme: ResolvedTheme) {
  if (background.kind === 'default') return 'var(--app-bg)';

  // User-selected colors and images can have any luminance. A strong theme
  // scrim keeps shell text readable while allowing the background through.
  const overlay = resolvedTheme === 'dark' ? 'rgba(3, 7, 18, 0.78)' : 'rgba(248, 250, 252, 0.78)';
  if (background.kind === 'image') {
    return `linear-gradient(${overlay}, ${overlay}), url("${background.value}")`;
  }
  return `linear-gradient(${overlay}, ${overlay}), ${background.value}`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(storedTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => theme === 'system' ? systemTheme() : theme);
  const [background, setBackgroundState] = useState<BackgroundPreference>(storedBackground);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const nextTheme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      setResolvedTheme(nextTheme);
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.style.colorScheme = nextTheme;
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.setAttribute('content', nextTheme === 'dark' ? '#111827' : '#2563eb');
    };

    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-background', cssBackground(background, resolvedTheme));
    document.documentElement.dataset.background = background.kind;
  }, [background, resolvedTheme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    resolvedTheme,
    background,
    setTheme: (nextTheme) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      setThemeState(nextTheme);
    },
    setBackground: (nextBackground) => {
      if (!isSafeBackground(nextBackground)) return;
      try {
        if (nextBackground.kind === 'default') {
          window.localStorage.removeItem(BACKGROUND_STORAGE_KEY);
        } else {
          window.localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(nextBackground));
        }
        setBackgroundState(nextBackground);
      } catch (error) {
        console.error('Unable to save background preference:', error);
      }
    },
  }), [background, resolvedTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
