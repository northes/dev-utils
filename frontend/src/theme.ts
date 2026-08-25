export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeId =
  | 'default-light'
  | 'default-dark'
  | 'modern-minimal-light'
  | 'modern-minimal-dark';

export const THEME_OPTIONS = [
  { id: 'default-light', tone: 'light', labelKey: 'settings.themeDefault' },
  { id: 'default-dark', tone: 'dark', labelKey: 'settings.themeDefault' },
  {
    id: 'modern-minimal-light',
    tone: 'light',
    labelKey: 'settings.themeModernMinimal',
  },
  {
    id: 'modern-minimal-dark',
    tone: 'dark',
    labelKey: 'settings.themeModernMinimal',
  },
] as const satisfies ReadonlyArray<{ id: ThemeId; tone: 'light' | 'dark'; labelKey: string }>;

export const THEME_MODE_OPTIONS = [
  { id: 'light', labelKey: 'settings.themeModeLight' },
  { id: 'dark', labelKey: 'settings.themeModeDark' },
  { id: 'system', labelKey: 'settings.themeModeSystem' },
] as const satisfies ReadonlyArray<{ id: ThemeMode; labelKey: string }>;

export function normalizeThemeId(theme: string, tone: 'light' | 'dark'): ThemeId {
  if (THEME_OPTIONS.some((option) => option.id === theme && option.tone === tone)) {
    return theme as ThemeId;
  }
  return tone === 'light' ? 'default-light' : 'default-dark';
}

export function resolveTheme(
  mode: string,
  lightTheme: string,
  darkTheme: string,
  systemDark: boolean,
): ThemeId {
  const tone =
    mode === 'system' ? (systemDark ? 'dark' : 'light') : mode === 'dark' ? 'dark' : 'light';
  return normalizeThemeId(tone === 'light' ? lightTheme : darkTheme, tone);
}
