// Supported UI locales. New locale = add here + create a file in
// ./locales/<code>.ts. CallStage / IncomingCall / etc. only accept
// strings declared in this union → missing translation = compile error
// (the en/tr reference files act as the source of truth).
export const LOCALES = ['tr', 'en', 'de', 'fr', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

// English names for the language picker (always shown in the user's chosen
// UI language, NOT localised — keeps the picker one step removed from
// translation churn)
export const LOCALE_LABEL: Record<Locale, string> = {
  tr: 'Türkçe',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
};

// Native script flags for the language picker (emoji, no assets)
export const LOCALE_FLAG: Record<Locale, string> = {
  tr: '🇹🇷',
  en: '🇬🇧',
  de: '🇩🇪',
  fr: '🇫🇷',
  es: '🇪🇸',
};
