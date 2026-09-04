/**
 * Login / bootstrap screen.
 *
 * Detects whether an administrator exists: GET /api/auth/session 401 with
 * bootstrap-available signal drives the create-admin flow (localhost-only
 * on the server); otherwise normal sign-in.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, UnauthorizedError } from './api.js';
import { useI18n } from './i18n-context.js';

type Mode = 'checking' | 'bootstrap' | 'login';

export function LoginPage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Probe: if session exists we would not be here; check bootstrap state
  // by attempting bootstrap with empty body and reading the error code.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await api.session();
        if (!cancelled) onAuthenticated();
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) {
          if (!cancelled) setMode('login');
          return;
        }
        // Determine bootstrap availability: a deliberately-empty bootstrap
        // probe returning 400 (invalid input) means bootstrap is OPEN (no
        // admin yet); 409 means completed.
        try {
          await api.bootstrap('', '');
          if (!cancelled) setMode('login');
        } catch (probeError) {
          if (!cancelled) {
            setMode(
              probeError instanceof ApiError &&
                probeError.message.includes('bootstrap_already_completed')
                ? 'login'
                : 'bootstrap'
            );
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'bootstrap') {
        await api.bootstrap(username.trim(), password);
      } else {
        await api.login(username.trim(), password);
      }
      onAuthenticated();
    } catch (submitError) {
      if (submitError instanceof UnauthorizedError) {
        setError(t('login.error'));
      } else if (submitError instanceof ApiError) {
        setError(t('common.error'));
      } else {
        setError(t('common.error'));
      }
      setBusy(false);
    }
  };

  if (mode === 'checking') {
    return <div className="login-page"><p>{t('common.loading')}</p></div>;
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <h1>{mode === 'bootstrap' ? t('login.bootstrap_title') : t('login.title')}</h1>
        <p className="login-app-name">{t('app.title')}</p>
        {mode === 'bootstrap' && <p className="hint">{t('login.bootstrap_hint')}</p>}

        <label>
          <span>{t('login.username')}</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label>
          <span>{t('login.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'bootstrap' ? 'new-password' : 'current-password'}
          />
        </label>

        {error !== null && <p className="form-error" role="alert">{error}</p>}

        <button type="submit" disabled={busy || username.length === 0 || password.length === 0}>
          {mode === 'bootstrap' ? t('login.bootstrap_submit') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
