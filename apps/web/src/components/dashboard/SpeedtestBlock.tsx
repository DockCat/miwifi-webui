import { useState, useEffect, useCallback } from 'react';
import { api, type SpeedtestResultDTO, type SpeedtestProviderType } from '../../api.js';
import { useI18n } from '../../i18n-context.js';
import { Card } from '../../components.js';

const STORAGE_PROVIDER_KEY = 'miwifi_speedtest_provider';

export interface SpeedtestBlockProps {
  readonly routerId?: string;
  readonly liveEvent?: { type: string; data: Record<string, unknown> } | null;
  readonly initialResult?: SpeedtestResultDTO | null;
}

export function formatMbps(bps: number): string {
  if (bps <= 0) return '0';
  const mbps = bps / 1_000_000;
  return mbps >= 100 ? Math.round(mbps).toString() : mbps.toFixed(1);
}

export function SpeedtestBlock({ routerId, liveEvent, initialResult }: SpeedtestBlockProps) {
  const { t, locale } = useI18n();

  const [provider, setProvider] = useState<SpeedtestProviderType>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const stored = localStorage.getItem(STORAGE_PROVIDER_KEY);
        if (stored === 'auto' || stored === 'cloudflare' || stored === 'fast') {
          return stored;
        }
      } catch {
        // Fallback on storage errors
      }
    }
    return 'auto';
  });

  const [latestResult, setLatestResult] = useState<SpeedtestResultDTO | null>(() => {
    if (initialResult) return initialResult;
    if (liveEvent?.type === 'speedtest-complete') {
      const data = liveEvent.data as unknown as SpeedtestResultDTO;
      if (data && typeof data.downloadBps === 'number') {
        return data;
      }
    }
    return null;
  });
  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load latest result on mount or router change
  useEffect(() => {
    let active = true;
    api.speedtestLatest(routerId)
      .then((res) => {
        if (active && res.latest) {
          setLatestResult(res.latest);
        }
      })
      .catch(() => {
        // Silently ignore initial fetch error
      });
    return () => {
      active = false;
    };
  }, [routerId]);

  // Handle SSE live events
  useEffect(() => {
    if (!liveEvent) return;
    if (liveEvent.type === 'speedtest-start') {
      setIsRunning(true);
      setErrorMsg(null);
    } else if (liveEvent.type === 'speedtest-complete') {
      setIsRunning(false);
      const data = liveEvent.data as unknown as SpeedtestResultDTO;
      if (data && typeof data.downloadBps === 'number') {
        setLatestResult(data);
      }
    }
  }, [liveEvent]);

  const handleProviderChange = (newProvider: SpeedtestProviderType) => {
    setProvider(newProvider);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(STORAGE_PROVIDER_KEY, newProvider);
      } catch {
        // Storage unavailable
      }
    }
  };

  const handleRunTest = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const res = await api.speedtestRun(provider);
      setLatestResult(res.result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, provider]);

  const formatTestTime = (isoString?: string): string => {
    if (!isoString) return t('dashboard.speedtest_never');
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  return (
    <Card className="speedtest-block">
      <div className="speedtest-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>🚀</span>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{t('dashboard.speedtest')}</h3>
        </div>
        <select
          className="speedtest-provider-select"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as SpeedtestProviderType)}
          disabled={isRunning}
          style={{
            fontSize: '12px',
            padding: '3px 8px',
            borderRadius: '6px',
            border: '1px solid var(--color-border, #334155)',
            background: 'var(--color-bg-subtle, #1e293b)',
            color: 'var(--color-text, #f8fafc)',
            cursor: isRunning ? 'not-allowed' : 'pointer'
          }}
        >
          <option value="auto">{t('dashboard.speedtest_provider_auto')}</option>
          <option value="cloudflare">{t('dashboard.speedtest_provider_cloudflare')}</option>
          <option value="fast">{t('dashboard.speedtest_provider_fast')}</option>
        </select>
      </div>

      <div className="speedtest-metrics-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
        <div className="speedtest-metric-card" style={{ background: 'rgba(37, 99, 235, 0.08)', borderRadius: '8px', padding: '10px 12px', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
          <div style={{ fontSize: '12px', color: '#60a5fa', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>↓</span> {t('dashboard.speedtest_download')}
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#93c5fd' }}>
            {latestResult ? formatMbps(latestResult.downloadBps) : '—'}
            <span style={{ fontSize: '13px', fontWeight: 400, color: '#94a3b8', marginLeft: '4px' }}>Mbps</span>
          </div>
        </div>

        <div className="speedtest-metric-card" style={{ background: 'rgba(16, 185, 129, 0.08)', borderRadius: '8px', padding: '10px 12px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
          <div style={{ fontSize: '12px', color: '#34d399', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>↑</span> {t('dashboard.speedtest_upload')}
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#6ee7b7' }}>
            {latestResult ? formatMbps(latestResult.uploadBps) : '—'}
            <span style={{ fontSize: '13px', fontWeight: 400, color: '#94a3b8', marginLeft: '4px' }}>Mbps</span>
          </div>
        </div>
      </div>

      <div className="speedtest-details" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '14px' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <span>
            {t('dashboard.speedtest_ping')}:{' '}
            <strong style={{ color: 'var(--color-text, #f8fafc)' }}>
              {latestResult ? `${latestResult.pingMs} ms` : '—'}
            </strong>
          </span>
          {latestResult && latestResult.jitterMs > 0 && (
            <span>
              {t('dashboard.speedtest_jitter')}:{' '}
              <strong style={{ color: 'var(--color-text, #f8fafc)' }}>{latestResult.jitterMs} ms</strong>
            </span>
          )}
        </div>
        {latestResult && (
          <span
            className={`speedtest-source-badge badge-${latestResult.source}`}
            style={{
              fontSize: '11px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: latestResult.source === 'router' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(148, 163, 184, 0.2)',
              color: latestResult.source === 'router' ? '#60a5fa' : '#cbd5e1'
            }}
          >
            {latestResult.source === 'router' ? t('dashboard.speedtest_source_router') : t('dashboard.speedtest_source_backend')}
          </span>
        )}
      </div>

      {errorMsg && (
        <div style={{ fontSize: '12px', color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 10px', borderRadius: '6px', marginBottom: '10px' }}>
          {errorMsg}
        </div>
      )}

      <div className="speedtest-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--color-border, #334155)' }}>
        <span style={{ fontSize: '11px', color: 'var(--color-text-muted, #64748b)' }}>
          {latestResult ? `${t('dashboard.speedtest_last_tested')}: ${formatTestTime(latestResult.createdAt)}` : t('dashboard.speedtest_never')}
        </span>
        <button
          type="button"
          className="button button-primary speedtest-run-btn"
          onClick={handleRunTest}
          disabled={isRunning}
          style={{
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            opacity: isRunning ? 0.7 : 1
          }}
        >
          {isRunning ? (
            <>
              <span className="spinner" style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <span>{t('dashboard.speedtest_running')}</span>
            </>
          ) : (
            t('dashboard.speedtest_run')
          )}
        </button>
      </div>
    </Card>
  );
}
