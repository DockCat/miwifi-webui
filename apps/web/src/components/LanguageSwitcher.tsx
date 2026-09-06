/**
 * Language switcher (en / zh-CN). Shared by the sidebar and the login page.
 * Selecting a locale persists the choice and re-renders the whole UI.
 */
import { LOCALES, LOCALE_LABELS } from '../i18n.js';
import { useI18n } from '../i18n-context.js';

export function LanguageSwitcher({ variant = 'sidebar' }: { variant?: 'sidebar' | 'login' }) {
  const { locale, setLocale } = useI18n();

  return (
    <select
      className={`language-select language-select-${variant}`}
      value={locale}
      onChange={(event) => setLocale(event.target.value as (typeof LOCALES)[number])}
      aria-label={locale === 'zh-CN' ? '界面语言' : 'Interface language'}
    >
      {LOCALES.map((option) => (
        <option key={option} value={option}>
          {LOCALE_LABELS[option]}
        </option>
      ))}
    </select>
  );
}
