import { createContext, useContext } from 'react';
import { translate, type Locale, type MessageKey } from './i18n.js';

interface I18nContextValue {
  readonly locale: Locale;
  readonly t: (key: MessageKey) => string;
  /** Switch the UI language (persists the choice for future visits). */
  readonly setLocale: (locale: Locale) => void;
}

/**
 * The default context never re-renders on its own; App always provides a
 * concrete value, so this is only the type-level fallback.
 */
export const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  t: (key) => translate('en', key),
  setLocale: () => {}
});

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
