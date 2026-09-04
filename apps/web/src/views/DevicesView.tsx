/**
 * Devices table + device detail with presence timeline.
 * Dense table (UniFi-inspired), status via badge with text.
 */
import { useEffect, useState } from 'react';
import { api, type DeviceRow, type PresenceEvent, type RouterSummary } from '../api.js';
import { Card, EmptyState, StatusBadge } from '../components.js';
import { useI18n } from '../i18n-context.js';
import { formatTime } from './DashboardView.js';

export function DevicesView({
  router,
  deviceId,
  onOpenDevice,
  initialDevices
}: {
  router: RouterSummary | null;
  deviceId?: string;
  onOpenDevice: (id: string) => void;
  /** Preloaded rows (tests / SSR); when omitted the view fetches. */
  initialDevices?: DeviceRow[];
}) {
  const { t } = useI18n();
  const [devices, setDevices] = useState<DeviceRow[] | null>(initialDevices ?? null);
  const [presence, setPresence] = useState<PresenceEvent[] | null>(null);

  useEffect(() => {
    if (!router) return;
    if (initialDevices !== undefined) return; // fixture supplied
    void (async () => {
      try {
        const result = await api.devices(router.id);
        setDevices(result.devices);
      } catch {
        setDevices([]);
      }
    })();
  }, [router, initialDevices]);

  useEffect(() => {
    if (!router || !deviceId) return;
    void (async () => {
      try {
        const result = await api.presence(router.id, deviceId);
        setPresence(result.events);
      } catch {
        setPresence([]);
      }
    })();
  }, [router, deviceId]);

  if (!router) {
    return (
      <Card title={t('devices.title')}>
        <EmptyState>{t('dashboard.no_routers')}</EmptyState>
      </Card>
    );
  }

  if (deviceId) {
    const device = devices?.find((entry) => entry.id === deviceId);
    return (
      <div>
        <button className="link-button" onClick={() => onOpenDevice('')}>
          ← {t('devices.back')}
        </button>
        <Card title={device?.name ?? device?.mac ?? deviceId}>
          {device && (
            <dl className="stats">
              <div>
                <dt>{t('devices.ip')}</dt>
                <dd>{device.ip ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('devices.mac')}</dt>
                <dd>{device.mac ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('devices.status')}</dt>
                <dd>
                  <StatusBadge
                    online={device.online}
                    label={device.online ? t('status.online') : t('status.offline')}
                  />
                </dd>
              </div>
              <div>
                <dt>{t('devices.first_seen')}</dt>
                <dd>{formatTime(device.firstSeenAt)}</dd>
              </div>
              <div>
                <dt>{t('devices.last_seen')}</dt>
                <dd>{formatTime(device.lastSeenAt)}</dd>
              </div>
            </dl>
          )}
          <h3>{t('device.timeline')}</h3>
          {presence === null || presence.length === 0 ? (
            <EmptyState>{t('device.empty_timeline')}</EmptyState>
          ) : (
            <ul className="timeline">
              {presence.map((event) => (
                <li key={event.id} className={`timeline-item ${event.kind.toLowerCase()}`}>
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

  return (
    <Card title={t('devices.title')}>
      {devices === null ? (
        <p>{t('common.loading')}</p>
      ) : devices.length === 0 ? (
        <EmptyState>{t('devices.empty')}</EmptyState>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('devices.name')}</th>
              <th>{t('devices.ip')}</th>
              <th>{t('devices.mac')}</th>
              <th>{t('devices.status')}</th>
              <th>{t('devices.first_seen')}</th>
              <th>{t('devices.last_seen')}</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr
                key={device.id}
                className="row-clickable"
                onClick={() => onOpenDevice(device.id)}
              >
                <td>{device.name ?? device.mac ?? device.id}</td>
                <td>{device.ip ?? '—'}</td>
                <td className="mono">{device.mac ?? '—'}</td>
                <td>
                  <StatusBadge
                    online={device.online}
                    label={device.online ? t('status.online') : t('status.offline')}
                  />
                </td>
                <td>{formatTime(device.firstSeenAt)}</td>
                <td>{formatTime(device.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
