/**
 * Settings: router onboarding form, password change, sign-out.
 * Router password is submitted once and never displayed back.
 */
import { useState } from 'react';
import { api, ApiError, type RouterSummary } from '../api.js';
import { Card } from '../components.js';
import { useI18n } from '../i18n-context.js';

export function SettingsView({
  router,
  onRoutersChanged,
  onLogout
}: {
  router: RouterSummary | null;
  onRoutersChanged: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [host, setHost] = useState('');
  const [routerUser, setRouterUser] = useState('admin');
  const [routerPassword, setRouterPassword] = useState('');
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [onboardBusy, setOnboardBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const submitOnboard = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setOnboardBusy(true);
    setOnboardError(null);
    try {
      await api.onboardRouter(host.trim(), routerUser.trim(), routerPassword);
      setHost('');
      setRouterPassword('');
      onRoutersChanged();
    } catch (error) {
      if (error instanceof ApiError) {
        setOnboardError(
          error.message === 'invalid_router_target'
            ? t('common.error') + ' (invalid router address)'
            : error.message === 'incompatible_router'
              ? 'Router is not compatible (probe failed).'
              : t('common.error')
        );
      } else {
        setOnboardError(t('common.error'));
      }
    } finally {
      setOnboardBusy(false);
    }
  };

  const submitPassword = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPwMessage(null);
    setPwError(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPwMessage(t('settings.change_password') + ' ✓');
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(onLogout, 800);
    } catch (error) {
      setPwError(error instanceof ApiError ? error.message : t('common.error'));
    }
  };

  return (
    <div className="view-grid">
      <Card title={t('settings.routers')}>
        {router && (
          <dl className="stats">
            <div>
              <dt>{t('settings.router_host')}</dt>
              <dd className="mono">{router.host}</dd>
            </div>
            <div>
              <dt>{t('settings.router_compatibility')}</dt>
              <dd>{router.compatibility}</dd>
            </div>
          </dl>
        )}
        <form className="stack" onSubmit={(event) => void submitOnboard(event)}>
          <label>
            <span>{t('settings.router_host')}</span>
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="192.168.31.1"
              required
            />
          </label>
          <label>
            <span>{t('settings.router_username')}</span>
            <input value={routerUser} onChange={(event) => setRouterUser(event.target.value)} />
          </label>
          <label>
            <span>{t('settings.router_password')}</span>
            <input
              type="password"
              value={routerPassword}
              onChange={(event) => setRouterPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          {onboardError && <p className="form-error" role="alert">{onboardError}</p>}
          <button type="submit" disabled={onboardBusy || host.length === 0}>
            {t('settings.router_add')}
          </button>
        </form>
      </Card>

      <Card title={t('settings.change_password')}>
        <form className="stack" onSubmit={(event) => void submitPassword(event)}>
          <label>
            <span>{t('settings.current_password')}</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            <span>{t('settings.new_password')}</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={10}
            />
          </label>
          {pwError && <p className="form-error" role="alert">{pwError}</p>}
          {pwMessage && <p className="form-ok" role="status">{pwMessage}</p>}
          <button type="submit" disabled={currentPassword.length === 0 || newPassword.length < 10}>
            {t('common.save')}
          </button>
        </form>
        <button className="link-button" onClick={() => void onLogout()}>
          {t('settings.logout')}
        </button>
      </Card>
    </div>
  );
}
