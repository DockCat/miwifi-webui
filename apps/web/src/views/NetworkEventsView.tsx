/**
 * Network + Events views: router status overview and presence history.
 */
import { useEffect, useState } from 'react';
import { api, type PresenceEvent, type RouterSummary } from '../api.js';
import { Card, EmptyState } from '../components.js';
import { useI18n } from '../i18n-context.js';
import { formatTime } from './DashboardView.js';

export function NetworkView({ router }: { router: RouterSummary | null }) {
  const { t } = useI18n();

  if (!router) {
    return (
      <Card title={t('nav.network')}>
        <EmptyState>{t('dashboard.no_routers')}</EmptyState>
      </Card>
    );
  }

  return (
    <Card title={t('nav.network')}>
      <dl className="stats">
        <div>
          <dt>{t('settings.router_host')}</dt>
          <dd className="mono">{router.host}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{router.model ?? '—'}</dd>
        </div>
        <div>
          <dt>Firmware</dt>
          <dd>{router.romVersion ?? '—'}</dd>
        </div>
        <div>
          <dt>{t('settings.router_compatibility')}</dt>
          <dd>
            <span className={`badge compat-${router.compatibility.toLowerCase()}`}>
              {router.compatibility}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t('settings.router_capabilities')}</dt>
          <dd>{router.capabilities.join(', ') || '—'}</dd>
        </div>
      </dl>
    </Card>
  );
}

export function EventsView({ router }: { router: RouterSummary | null }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<PresenceEvent[] | null>(null);

  useEffect(() => {
    if (!router) return;
    void (async () => {
      try {
        const result = await api.presence(router.id);
        setEvents(result.events);
      } catch {
        setEvents([]);
      }
    })();
  }, [router]);

  if (!router) {
    return (
      <Card title={t('events.title')}>
        <EmptyState>{t('dashboard.no_routers')}</EmptyState>
      </Card>
    );
  }

  return (
    <Card title={t('events.title')}>
      {events === null ? (
        <p>{t('common.loading')}</p>
      ) : events.length === 0 ? (
        <EmptyState>{t('events.empty')}</EmptyState>
      ) : (
        <ul className="event-list">
          {events.map((event) => (
            <li key={event.id}>
              <span className="event-kind">{t(`presence.${event.kind}`)}</span>
              <span className="mono muted">{event.deviceId.slice(0, 8)}</span>
              <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
