/**
 * App shell: session gate, persistent navigation, view routing, live SSE.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type RouterSummary, UnauthorizedError } from './api.js';
import { I18nContext } from './i18n-context.js';
import {
  initialLocale,
  storeLocale,
  translate,
  type Locale,
  type MessageKey
} from './i18n.js';
import { LanguageSwitcher } from './components/LanguageSwitcher.js';
import { LoginPage } from './LoginPage.js';
import { useRoute } from './router.js';
import { DashboardView } from './views/DashboardView.js';
import { DevicesView } from './views/DevicesView.js';
import { EventsView, NetworkView } from './views/NetworkEventsView.js';
import { InvestigationsView } from './views/InvestigationsView.js';
import { SettingsView } from './views/SettingsView.js';
import { useLiveEvents } from './use-live-events.js';

type AuthState =
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; username: string };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'checking' });
  const [routers, setRouters] = useState<RouterSummary[]>([]);
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [route, navigate] = useRoute();
  const [refreshTick, setRefreshTick] = useState(0);

  const t = useCallback((key: MessageKey) => translate(locale, key), [locale]);

  const setLocale = useCallback((next: Locale): void => {
    setLocaleState(next);
    storeLocale(next);
  }, []);

  // Keep <html lang> in sync for accessibility and CJK font selection.
  useEffect(() => {
    document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
  }, [locale]);

  const loadRouters = useCallback(async (): Promise<void> => {
    try {
      const result = await api.routers();
      setRouters(result.routers);
    } catch (error) {
      if (error instanceof UnauthorizedError) setAuth({ kind: 'signed-out' });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = await api.session();
        setAuth({ kind: 'signed-in', username: session.username });
        await loadRouters();
      } catch {
        setAuth({ kind: 'signed-out' });
      }
    })();
  }, [loadRouters]);

  // Session-expiry heartbeat: a 401 from any poll flips to signed-out.
  useLiveEvents(auth.kind === 'signed-in' && routers.length > 0, (event) => {
    if (event.type === 'router-status' && event.data['unreachable'] === true) {
      setRefreshTick((tick) => tick + 1);
    }
  });

  if (auth.kind === 'checking') {
    return <div className="app-loading">{t('common.loading')}</div>;
  }

  if (auth.kind === 'signed-out') {
    return (
      <I18nContext.Provider value={{ locale, t, setLocale }}>
        <LoginPage
          onAuthenticated={async () => {
            const session = await api.session();
            setAuth({ kind: 'signed-in', username: session.username });
            await loadRouters();
          }}
        />
      </I18nContext.Provider>
    );
  }

  const activeRouter = routers[0] ?? null;

  const handleLogout = async (): Promise<void> => {
    await api.logout().catch(() => undefined);
    setAuth({ kind: 'signed-out' });
    setRouters([]);
  };

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      <div className="shell">
        <nav className="sidebar">
          <div className="brand">
            <span className="brand-name">{t('app.title')}</span>
            <span className="brand-sub">{t('app.tagline')}</span>
          </div>
          <ul>
            <NavItem
              label={t('nav.dashboard')}
              active={route.page === 'dashboard'}
              onClick={() => navigate({ page: 'dashboard' })}
            />
            <NavItem
              label={t('nav.devices')}
              active={route.page === 'devices'}
              onClick={() => navigate({ page: 'devices' })}
            />
            <NavItem
              label={t('nav.network')}
              active={route.page === 'network'}
              onClick={() => navigate({ page: 'network' })}
            />
            <NavItem
              label={t('nav.events')}
              active={route.page === 'events'}
              onClick={() => navigate({ page: 'events' })}
            />
            <NavItem
              label={t('nav.investigations')}
              active={route.page === 'investigations'}
              onClick={() => navigate({ page: 'investigations' })}
            />
            <NavItem
              label={t('nav.settings')}
              active={route.page === 'settings'}
              onClick={() => navigate({ page: 'settings' })}
            />
          </ul>
          <div className="sidebar-footer">
            <span className="muted">{auth.username}</span>
            <LanguageSwitcher />
            <button className="link-button" onClick={() => void handleLogout()}>
              {t('settings.logout')}
            </button>
          </div>
        </nav>
        <main className="content" key={refreshTick}>
          {route.page === 'dashboard' && <DashboardView router={activeRouter} />}
          {route.page === 'devices' && (
            <DevicesView
              router={activeRouter}
              deviceId={route.deviceId}
              onOpenDevice={(id) => navigate({ page: 'devices', deviceId: id })}
            />
          )}
          {route.page === 'network' && <NetworkView router={activeRouter} />}
          {route.page === 'events' && <EventsView router={activeRouter} />}
          {route.page === 'investigations' && <InvestigationsView router={activeRouter} />}
          {route.page === 'settings' && (
            <SettingsView
              router={activeRouter}
              onRoutersChanged={() => void loadRouters()}
              onLogout={() => void handleLogout()}
            />
          )}
        </main>
      </div>
    </I18nContext.Provider>
  );
}

function NavItem({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        className={`nav-item ${active ? 'is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
      >
        {label}
      </button>
    </li>
  );
}
