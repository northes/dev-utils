import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', labelKey: 'settings.languages.zh-CN' },
  { code: 'en-US', labelKey: 'settings.languages.en-US' },
] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];
export const DEFAULT_LANGUAGE: LanguageCode = 'zh-CN';

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

export default i18n;
