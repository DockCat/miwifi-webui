import { createContext, useContext } from 'react';
import { detectLocale, translate, type Locale, type MessageKey } from './i18n.js';

interface I18nContextValue {
  readonly locale: Locale;
  readonly t: (key: MessageKey) => string;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: detectLocale(),
  t: (key) => translate(detectLocale(), key)
});

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
