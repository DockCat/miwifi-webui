import { useEffect, useState } from 'react';
import { api, type DeviceRow, type PresenceEvent } from '../api.js';
import { StatusBadge } from '../components.js';
import { ConnectionIcon } from './ConnectionIcon.js';
import { InternetAccessControl } from '../InternetAccessControl.js';
import { useI18n } from '../i18n-context.js';
import { formatSpeed } from './charts/UniFiAreaChart.js';
import { formatTime } from '../views/DashboardView.js';

export interface DeviceUsageDrawerProps {
  routerId: string;
  device: DeviceRow | null;
  onClose: () => void;
  canControl?: boolean;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function connectionTypeLabel(type?: string): string {
  switch (type) {
    case 'wired':
      return 'LAN (Wired)';
    case 'wifi_2g':
      return 'Wi-Fi (2.4 GHz)';
    case 'wifi_5g':
      return 'Wi-Fi (5 GHz)';
    case 'guest':
      return 'Guest Wi-Fi';
    default:
      return 'Unknown';
  }
}

export function DeviceUsageDrawer({
  routerId,
  device,
  onClose,
  canControl = true
}: DeviceUsageDrawerProps) {
  const { t } = useI18n();
  const [presence, setPresence] = useState<PresenceEvent[]>([]);
  const [blockedOverride, setBlockedOverride] = useState<boolean | null>(null);

  useEffect(() => {
    if (!device) return;
    setBlockedOverride(null);
    void (async () => {
      try {
        const res = await api.presence(routerId, device.id);
        setPresence(res.events.slice(0, 10));
      } catch {
        setPresence([]);
      }
    })();
  }, [routerId, device]);

  if (!device) return null;

  const currentAccess =
    blockedOverride !== null ? blockedOverride : device.internetAccess;

  const totalTransfer = (device.downloadTotal ?? 0) + (device.uploadTotal ?? 0);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="device-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title-group">
            <div className="device-avatar-big">
              <ConnectionIcon connectionType={device.connectionType} size={22} />
            </div>
            <div>
              <h2 className="drawer-device-name">
                {device.name ?? device.mac ?? device.id}
              </h2>
              <span className="drawer-device-ip mono">{device.ip ?? '—'}</span>
            </div>
          </div>
          <button className="drawer-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {/* Status and Connection Badges */}
          <div className="drawer-badges">
            <StatusBadge
              online={device.online}
              label={device.online ? t('status.online') : t('status.offline')}
            />
            <span className="badge badge-connection-type">
              {connectionTypeLabel(device.connectionType)}
            </span>
          </div>

          {/* Real-time speed cards */}
          <div className="drawer-stats-grid">
            <div className="drawer-stat-card down">
              <span className="stat-label">↓ {t('devices.downspeed')}</span>
              <span className="stat-val">{formatSpeed(device.downspeed ?? 0)}</span>
            </div>
            <div className="drawer-stat-card up">
              <span className="stat-label">↑ {t('devices.upspeed')}</span>
              <span className="stat-val">{formatSpeed(device.upspeed ?? 0)}</span>
            </div>
          </div>

          {/* Cumulative traffic cards */}
          <div className="drawer-section">
            <h3 className="drawer-section-title">{t('devices.traffic_total')}</h3>
            <div className="drawer-traffic-summary">
              <div className="traffic-metric">
                <span className="metric-label">{t('devices.download_total')}</span>
                <span className="metric-val">{formatBytes(device.downloadTotal ?? 0)}</span>
              </div>
              <div className="traffic-metric">
                <span className="metric-label">{t('devices.upload_total')}</span>
                <span className="metric-val">{formatBytes(device.uploadTotal ?? 0)}</span>
              </div>
              <div className="traffic-metric highlight">
                <span className="metric-label">{t('devices.total_data')}</span>
                <span className="metric-val">{formatBytes(totalTransfer)}</span>
              </div>
            </div>
          </div>

          {/* Network details */}
          <div className="drawer-section">
            <h3 className="drawer-section-title">{t('devices.details')}</h3>
            <dl className="drawer-detail-list">
              <div>
                <dt>{t('devices.mac')}</dt>
                <dd className="mono">{device.mac ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('devices.ip')}</dt>
                <dd className="mono">{device.ip ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('devices.connection')}</dt>
                <dd>{connectionTypeLabel(device.connectionType)}</dd>
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
          </div>

          {/* Internet Access Control */}
          <div className="drawer-section">
            <h3 className="drawer-section-title">{t('devices.internet_control')}</h3>
            <InternetAccessControl
              routerId={routerId}
              deviceId={device.id}
              internetAccess={currentAccess}
              canControl={canControl}
              onChanged={(blocked) => setBlockedOverride(blocked)}
            />
          </div>

          {/* Presence history */}
          <div className="drawer-section">
            <h3 className="drawer-section-title">{t('device.timeline')}</h3>
            {presence.length === 0 ? (
              <p className="muted small">{t('device.empty_timeline')}</p>
            ) : (
              <ul className="timeline">
                {presence.map((event) => (
                  <li
                    key={event.id}
                    className={`timeline-item ${event.kind.toLowerCase()}`}
                  >
                    <span className="event-kind">{t(`presence.${event.kind}`)}</span>
                    <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
