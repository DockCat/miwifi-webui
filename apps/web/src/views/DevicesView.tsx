/**
 * Devices table + device detail with presence timeline.
 * Dense table (UniFi-inspired), status via badge with text.
 */
import { useEffect, useState } from 'react';
import { api, type DeviceRow, type PresenceEvent, type RouterSummary } from '../api.js';
import { Card, EmptyState, StatusBadge } from '../components.js';
import { InternetAccessControl } from '../InternetAccessControl.js';
import { useI18n } from '../i18n-context.js';
import { formatTime } from './DashboardView.js';
import { formatSpeed } from '../components/charts/UniFiAreaChart.js';
import { connectionTypeLabel, formatBytes } from '../components/DeviceUsageDrawer.js';

/** Local view-state: device id -> internetAccess override after a mutation. */
type AccessOverride = Record<string, boolean | null>;

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
  const [accessOverride, setAccessOverride] = useState<AccessOverride>({});
  const canControl =
    router?.capabilities.includes('device-internet-access-control') ?? false;

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
                <dt>{t('devices.connection')}</dt>
                <dd>{connectionTypeLabel(device.connectionType)}</dd>
              </div>
              <div>
                <dt>{t('devices.downspeed')} / {t('devices.upspeed')}</dt>
                <dd className="mono">
                  ↓ {formatSpeed(device.downspeed ?? 0)} / ↑ {formatSpeed(device.upspeed ?? 0)}
                </dd>
              </div>
              <div>
                <dt>{t('devices.traffic_total')}</dt>
                <dd className="mono">
                  {formatBytes((device.downloadTotal ?? 0) + (device.uploadTotal ?? 0))}
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
              <th>{t('devices.connection')}</th>
              <th>{t('devices.ip')}</th>
              <th>{t('devices.mac')}</th>
              <th>{t('devices.status')}</th>
              <th>Speed</th>
              <th>Traffic</th>
              <th>{t('devices.last_seen')}</th>
              <th>Internet</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => {
              const access =
                device.id in accessOverride
                  ? accessOverride[device.id] === true
                  : device.internetAccess;
              return (
                <tr
                  key={device.id}
                  className="row-clickable"
                  onClick={() => onOpenDevice(device.id)}
                >
                  <td>{device.name ?? device.mac ?? device.id}</td>
                  <td>
                    <span className="badge badge-connection-type">
                      {connectionTypeLabel(device.connectionType)}
                    </span>
                  </td>
                  <td>{device.ip ?? '—'}</td>
                  <td className="mono">{device.mac ?? '—'}</td>
                  <td>
                    <StatusBadge
                      online={device.online}
                      label={device.online ? t('status.online') : t('status.offline')}
                    />
                  </td>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>
                    {device.online && ((device.downspeed ?? 0) > 0 || (device.upspeed ?? 0) > 0)
                      ? `↓ ${formatSpeed(device.downspeed ?? 0)}`
                      : '—'}
                  </td>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>
                    {(device.downloadTotal ?? 0) + (device.uploadTotal ?? 0) > 0
                      ? formatBytes((device.downloadTotal ?? 0) + (device.uploadTotal ?? 0))
                      : '—'}
                  </td>
                  <td>{formatTime(device.lastSeenAt)}</td>
                  <td
                    onClick={(event) => {
                      // Keep row-click navigation off the mutation controls.
                      event.stopPropagation();
                    }}
                  >
                    <InternetAccessControl
                      routerId={router.id}
                      deviceId={device.id}
                      internetAccess={access}
                      canControl={canControl}
                      onChanged={(blocked) =>
                        setAccessOverride((current) => ({ ...current, [device.id]: blocked }))
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
