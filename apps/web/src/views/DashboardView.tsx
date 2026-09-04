/**
 * Dashboard: router health snapshot, devices online, recent presence
 * events; live SSE updates.
 */
import { useEffect, useState } from 'react';
import { api, type PresenceEvent, type RouterSummary } from '../api.js';
import { useLiveEvents } from '../use-live-events.js';
import { Card, EmptyState } from '../components.js';
import { useI18n } from '../i18n-context.js';

interface StatusPayload {
  capturedAt?: string;
  cpuLoad?: number;
  memUsed?: number;
  memTotal?: number;
  wanUp?: boolean;
  deviceCount?: number;
  unreachable?: boolean;
}

export function DashboardView({ router }: { router: RouterSummary | null }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [recentEvents, setRecentEvents] = useState<PresenceEvent[]>([]);

  useEffect(() => {
    if (!router) return;
    void (async () => {
      try {
        const result = await api.routerStatus(router.id);
        setStatus(result.status as StatusPayload);
      } catch {
        setStatus({ unreachable: true });
      }
      try {
        const devices = await api.devices(router.id);
        setOnlineCount(devices.devices.filter((device) => device.online).length);
        const presence = await api.presence(router.id);
        setRecentEvents(presence.events.slice(0, 8));
      } catch {
        // Lists load empty; SSE will refresh.
      }
    })();
  }, [router]);

  useLiveEvents(router !== null, (event) => {
    if (event.type === 'router-status' && event.data['routerId'] === router?.id) {
      setStatus(event.data['status'] as StatusPayload);
    }
    if (event.type === 'presence' && event.data['routerId'] === router?.id) {
      setRecentEvents((current) => [
        {
          id: event.id,
          deviceId: String(event.data['deviceId'] ?? ''),
          routerId: String(event.data['routerId'] ?? ''),
          kind: String(event.data['kind']) as PresenceEvent['kind'],
          occurredAt: event.at
        },
        ...current
      ].slice(0, 8));
    }
    if (event.type === 'inventory' && event.data['routerId'] === router?.id) {
      const count = event.data['count'];
      if (typeof count === 'number') setOnlineCount(count);
    }
  });

  if (!router) {
    return (
      <Card title={t('dashboard.router_health')}>
        <EmptyState>{t('dashboard.no_routers')}</EmptyState>
      </Card>
    );
  }

  return (
    <div className="view-grid">
      <Card title={t('dashboard.router_health')}>
        {status === null ? (
          <p>{t('common.loading')}</p>
        ) : status.unreachable ? (
          <p>{t('status.unreachable')}</p>
        ) : (
          <dl className="stats">
            <div>
              <dt>{t('dashboard.cpu')}</dt>
              <dd>{status.cpuLoad !== undefined ? `${status.cpuLoad}%` : '—'}</dd>
            </div>
            <div>
              <dt>{t('dashboard.memory')}</dt>
              <dd>
                {status.memUsed !== undefined && status.memTotal !== undefined
                  ? `${status.memUsed}/${status.memTotal} MB`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>{t('dashboard.wan')}</dt>
              <dd>{status.wanUp === true ? t('status.online') : status.wanUp === false ? t('status.offline') : '—'}</dd>
            </div>
          </dl>
        )}
        <p className="muted">
          {router.model ?? router.host} · {router.romVersion ?? ''}
        </p>
      </Card>

      <Card title={t('dashboard.devices_online')}>
        <p className="stat-big">{onlineCount ?? '—'}</p>
      </Card>

      <Card title={t('dashboard.recent_events')}>
        {recentEvents.length === 0 ? (
          <EmptyState>{t('events.empty')}</EmptyState>
        ) : (
          <ul className="event-list">
            {recentEvents.map((event) => (
              <li key={event.id}>
                <span className="event-kind">{t(`presence.${event.kind}`)}</span>
                <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}
