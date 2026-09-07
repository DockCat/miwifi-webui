/**
 * UniFi-inspired operational dashboard:
 * Gateway overview with live utilization gauges, traffic overview donut chart,
 * client device breakdown, Wi-Fi band distribution, most active clients,
 * 24H/7D/30D throughput area chart, and device usage inspection drawer.
 */
import { useEffect, useState } from 'react';
import {
  api,
  type DeviceRow,
  type PresenceEvent,
  type RouterSummary,
  type TimeseriesPoint
} from '../api.js';
import { useLiveEvents } from '../use-live-events.js';
import { Card, EmptyState, StatusBadge } from '../components.js';
import { useI18n } from '../i18n-context.js';
import { UniFiDonutChart } from '../components/charts/UniFiDonutChart.js';
import { UniFiAreaChart, formatSpeed } from '../components/charts/UniFiAreaChart.js';
import { UniFiUtilizationGauge, WiFiBandBars } from '../components/charts/UniFiBarGauge.js';
import { DeviceUsageDrawer, formatBytes } from '../components/DeviceUsageDrawer.js';
import { ConnectionIcon } from '../components/ConnectionIcon.js';
import { useDashboardLayout } from '../components/dashboard/useDashboardLayout.js';
import { DashboardGrid, DashboardBlock } from '../components/dashboard/DashboardGrid.js';

interface StatusPayload {
  capturedAt?: string;
  cpuLoad?: number;
  memUsed?: number;
  memTotal?: number;
  wanUp?: boolean;
  deviceCount?: number;
  unreachable?: boolean;
  wanDownspeed?: number;
  wanUpspeed?: number;
  wanDownloadTotal?: number;
  wanUploadTotal?: number;
  upTimeSeconds?: number;
  temperature?: number;
}

const DONUT_COLORS = ['#2563eb', '#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#ec4899'];

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

export function formatUptime(seconds?: number): string {
  if (typeof seconds !== 'number' || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** LAN ports drawn on the gateway hardware art (matches AX6000-class layout). */
const LAN_PORT_COUNT = 3;

export interface GatewayHardwareArtProps {
  /** WAN uplink connected — lights the blue WAN port. */
  wanUp: boolean;
  /** Online wired clients — each lights one green LAN port (capped at 3). */
  wiredCount: number;
  /** Router reachable from the app — drives the power LED. */
  reachable: boolean;
}

/**
 * Gateway chassis illustration. Port lights reflect live state: the WAN
 * port follows the uplink, LAN ports light per online wired client. The
 * MiWiFi API exposes no per-port link state, so the wired-client count
 * is the proxy for occupied LAN ports.
 */
export function GatewayHardwareArt({ wanUp, wiredCount, reachable }: GatewayHardwareArtProps) {
  const lanLit = Math.max(0, Math.min(LAN_PORT_COUNT, wiredCount));
  return (
    <div className="gateway-hardware-art">
      <div className="rack-unit">
        <div className="rack-ports">
          <span
            className={`port wan${wanUp ? ' active' : ''}`}
            title={`WAN Port — ${wanUp ? 'connected' : 'down'}`}
          />
          {Array.from({ length: LAN_PORT_COUNT }, (_, i) => (
            <span
              key={i}
              className={`port lan${i < lanLit ? ' active' : ''}`}
              title={`LAN Port ${i + 1} — ${i < lanLit ? 'in use' : 'idle'}`}
            />
          ))}
        </div>
        <div className="rack-leds">
          <span className={`led power${reachable ? ' on' : ''}`} title="Power" />
          <span className={`led link${wanUp ? ' on' : ''}`} title="WAN link" />
        </div>
      </div>
    </div>
  );
}

export function DashboardView({ router }: { router: RouterSummary | null }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [recentEvents, setRecentEvents] = useState<PresenceEvent[]>([]);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [range, setRange] = useState<'1d' | '1w' | '1m'>('1d');
  const [trafficTab, setTrafficTab] = useState<'total' | 'live'>('total');
  const [clientTab, setClientTab] = useState<'all' | 'wired' | 'wireless' | 'guest'>('all');
  const [selectedDevice, setSelectedDevice] = useState<DeviceRow | null>(null);
  const {
    layout,
    commitLayout,
    isEditing,
    setIsEditing,
    updateBlockPosition,
    updateBlockSize,
    resetLayout
  } = useDashboardLayout(router?.id ?? 'default');

  // Initial load
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
        const devRes = await api.devices(router.id);
        setDevices(devRes.devices);
        setOnlineCount(devRes.devices.filter((d) => d.online).length);
      } catch {
        // Fallback empty
      }

      try {
        const presRes = await api.presence(router.id);
        setRecentEvents(presRes.events.slice(0, 8));
      } catch {
        // Fallback empty
      }
    })();
  }, [router]);

  // Timeseries range change load
  useEffect(() => {
    if (!router) return;
    void (async () => {
      try {
        const tsRes = await api.telemetryTimeseries(router.id, range);
        setTimeseries(tsRes.points);
      } catch {
        setTimeseries([]);
      }
    })();
  }, [router, range]);

  // Live SSE listener
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

      const liveDevs = event.data['devices'] as DeviceRow[] | undefined;
      if (Array.isArray(liveDevs)) {
        setDevices((current) => {
          const map = new Map(liveDevs.map((d) => [d.mac ?? d.ip ?? d.id, d]));
          return current.map((item) => {
            const match = map.get(item.mac ?? item.ip ?? item.id);
            if (match) {
              return {
                ...item,
                online: match.online,
                downspeed: match.downspeed,
                upspeed: match.upspeed,
                downloadTotal: match.downloadTotal,
                uploadTotal: match.uploadTotal,
                connectionType: match.connectionType
              };
            }
            return item;
          });
        });
      }
    }
  });

  if (!router) {
    return (
      <Card title={t('dashboard.router_health')}>
        <EmptyState>{t('dashboard.no_routers')}</EmptyState>
      </Card>
    );
  }

  // --- Metrics calculation ---
  const onlineDevices = devices.filter((d) => d.online);
  const wiredDevices = onlineDevices.filter((d) => d.connectionType === 'wired');
  const wifi2gDevices = onlineDevices.filter((d) => d.connectionType === 'wifi_2g');
  const wifi5gDevices = onlineDevices.filter((d) => d.connectionType === 'wifi_5g');
  const guestDevices = onlineDevices.filter((d) => d.connectionType === 'guest');

  // Filtered devices by tab
  const filteredClientDevices =
    clientTab === 'wired'
      ? wiredDevices
      : clientTab === 'wireless'
        ? [...wifi2gDevices, ...wifi5gDevices]
        : clientTab === 'guest'
          ? guestDevices
          : onlineDevices;

  // --- Traffic calculations ---
  const wanDownloadTotal = status?.wanDownloadTotal ?? 0;
  const wanUploadTotal = status?.wanUploadTotal ?? 0;
  const wanTotalTraffic = wanDownloadTotal + wanUploadTotal;

  const deviceDownloadSum = devices.reduce((sum, d) => sum + (d.downloadTotal ?? 0), 0);
  const deviceUploadSum = devices.reduce((sum, d) => sum + (d.uploadTotal ?? 0), 0);
  const totalIdentified = deviceDownloadSum + deviceUploadSum;

  const totalDownload = deviceDownloadSum > 0 ? deviceDownloadSum : wanDownloadTotal;
  const totalUpload = deviceUploadSum > 0 ? deviceUploadSum : wanUploadTotal;
  const displayTotalTraffic = totalIdentified > 0 ? totalIdentified : wanTotalTraffic;

  // Top devices by cumulative traffic
  const sortedByTraffic = [...devices]
    .filter((d) => (d.downloadTotal ?? 0) + (d.uploadTotal ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.downloadTotal ?? 0) +
        (b.uploadTotal ?? 0) -
        ((a.downloadTotal ?? 0) + (a.uploadTotal ?? 0))
    );

  const cumulativeSegments = sortedByTraffic.slice(0, 4).map((d, i) => ({
    label: d.name ?? d.mac ?? d.id,
    value: (d.downloadTotal ?? 0) + (d.uploadTotal ?? 0),
    color: DONUT_COLORS[i % DONUT_COLORS.length]!,
    key: d.id
  }));

  const otherCumulativeTraffic = sortedByTraffic
    .slice(4)
    .reduce((sum, d) => sum + (d.downloadTotal ?? 0) + (d.uploadTotal ?? 0), 0);

  if (otherCumulativeTraffic > 0) {
    cumulativeSegments.push({
      label: 'Other',
      value: otherCumulativeTraffic,
      color: '#6b7280',
      key: 'other'
    });
  }

  // Live rate calculations
  const wanDownspeed = status?.wanDownspeed ?? 0;
  const wanUpspeed = status?.wanUpspeed ?? 0;
  const liveThroughput = wanDownspeed + wanUpspeed;

  const sortedByLiveRate = [...onlineDevices]
    .filter((d) => (d.downspeed ?? 0) + (d.upspeed ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.downspeed ?? 0) +
        (b.upspeed ?? 0) -
        ((a.downspeed ?? 0) + (a.upspeed ?? 0))
    );

  const liveSegments = sortedByLiveRate.slice(0, 4).map((d, i) => ({
    label: d.name ?? d.mac ?? d.id,
    value: (d.downspeed ?? 0) + (d.upspeed ?? 0),
    color: DONUT_COLORS[i % DONUT_COLORS.length]!,
    key: d.id
  }));

  const otherLiveRate = sortedByLiveRate
    .slice(4)
    .reduce((sum, d) => sum + (d.downspeed ?? 0) + (d.upspeed ?? 0), 0);

  if (otherLiveRate > 0) {
    liveSegments.push({
      label: 'Other',
      value: otherLiveRate,
      color: '#6b7280',
      key: 'other'
    });
  }

  // Client Type segments
  const clientTypeSegments = [
    { label: 'Wired (LAN)', value: wiredDevices.length, color: '#2563eb' },
    { label: 'Wi-Fi 5 GHz', value: wifi5gDevices.length, color: '#10b981' },
    { label: 'Wi-Fi 2.4 GHz', value: wifi2gDevices.length, color: '#06b6d4' },
    ...(guestDevices.length > 0
      ? [{ label: 'Guest', value: guestDevices.length, color: '#8b5cf6' }]
      : [])
  ];

  // Most active clients: sort primarily by live rate; if equal/idle, fall back to cumulative traffic
  const mostActiveClients = [...onlineDevices]
    .sort((a, b) => {
      const rateA = (a.downspeed ?? 0) + (a.upspeed ?? 0);
      const rateB = (b.downspeed ?? 0) + (b.upspeed ?? 0);
      if (rateB !== rateA) return rateB - rateA;
      const trafficA = (a.downloadTotal ?? 0) + (a.uploadTotal ?? 0);
      const trafficB = (b.downloadTotal ?? 0) + (b.uploadTotal ?? 0);
      return trafficB - trafficA;
    })
    .slice(0, 6);

  return (
    <div className="unifi-dashboard">
      {/* Top Header Bar */}
      <div className="unifi-header">
        <div className="unifi-header-title">
          <span className="unifi-logo-halo" aria-hidden="true" />
          <h1>{t('nav.network')}</h1>
        </div>

        <div className="unifi-header-controls">
          <div className="gateway-badge">
            <span className="gateway-dot" />
            <span className="gateway-name">{router.model ?? router.host}</span>
          </div>

          <div className="unifi-range-pills">
            <button
              className={`pill-btn ${range === '1d' ? 'active' : ''}`}
              onClick={() => setRange('1d')}
            >
              {t('dashboard.range_1d')}
            </button>
            <button
              className={`pill-btn ${range === '1w' ? 'active' : ''}`}
              onClick={() => setRange('1w')}
            >
              {t('dashboard.range_1w')}
            </button>
            <button
              className={`pill-btn ${range === '1m' ? 'active' : ''}`}
              onClick={() => setRange('1m')}
            >
              {t('dashboard.range_1m')}
            </button>
          </div>

          <div className="layout-controls">
            {isEditing && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={resetLayout}
                title={t('dashboard.reset_layout')}
              >
                ↺ {t('dashboard.reset_layout')}
              </button>
            )}
            <button
              className={`btn btn-sm ${isEditing ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? `✓ ${t('dashboard.done_editing')}` : `⚙ ${t('dashboard.customize_layout')}`}
            </button>
          </div>
        </div>
      </div>

      {/* Main Customizable Grid Layout */}
      <DashboardGrid
        layout={layout}
        isEditing={isEditing}
        onLayoutChange={commitLayout}
        onBlockMove={updateBlockPosition}
        onBlockResize={updateBlockSize}
      >
        {/* 1. Gateway & Hardware Card */}
        <DashboardBlock id="gateway">
          <div className="gateway-adaptive-container">
            <div className="gateway-col-left">
              <div className="gateway-hero">
                <GatewayHardwareArt
                  wanUp={!status?.unreachable && (status?.wanUp ?? true)}
                  wiredCount={wiredDevices.length}
                  reachable={!status?.unreachable}
                />
                <div className="gateway-meta">
                  <h2 className="gateway-title">{router.model ?? router.host}</h2>
                  <span className="gateway-rom mono muted">
                    {router.romVersion ? `Firmware ${router.romVersion}` : 'MiWiFi OS'}
                  </span>
                </div>
              </div>

              <div className="gateway-info-list">
                <div className="info-row">
                  <span className="info-label">{t('dashboard.wan_ip')}</span>
                  <span className="info-val mono">{status?.wanUp ? router.host : '—'}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">{t('dashboard.gateway_ip')}</span>
                  <span className="info-val mono">{router.host}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">{t('dashboard.uptime')}</span>
                  <span className="info-val">{formatUptime(status?.upTimeSeconds)}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Status</span>
                  <StatusBadge
                    online={status?.unreachable ? false : (status?.wanUp ?? true)}
                    label={
                      status?.unreachable
                        ? t('status.unreachable')
                        : status?.wanUp === false
                          ? t('status.offline')
                          : t('status.online')
                    }
                  />
                </div>
              </div>
            </div>

            <div className="gateway-col-right">
              <div className="gateway-gauges">
                <UniFiUtilizationGauge
                  label={t('dashboard.down_utilization')}
                  speed={wanDownspeed}
                  variant="down"
                />
                <UniFiUtilizationGauge
                  label={t('dashboard.up_utilization')}
                  speed={wanUpspeed}
                  variant="up"
                />
              </div>

              <hr className="unifi-divider" />

              <div className="system-load-summary">
                <div className="load-metric">
                  <span className="load-label">{t('dashboard.cpu')}</span>
                  <span className="load-val">
                    {status?.cpuLoad !== undefined ? `${status.cpuLoad}%` : '—'}
                  </span>
                </div>
                <div className="load-metric">
                  <span className="load-label">{t('dashboard.memory')}</span>
                  <span className="load-val">
                    {status?.memUsed !== undefined
                      ? status?.memTotal !== undefined
                        ? `${status.memUsed}/${status.memTotal} MB`
                        : `${status.memUsed} MB`
                      : '—'}
                  </span>
                </div>
                <div className="load-metric">
                  <span className="load-label">{t('dashboard.temperature')}</span>
                  <span className="load-val">
                    {status?.temperature !== undefined && status.temperature > 0
                      ? `${status.temperature}°C`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </DashboardBlock>

        {/* 2. Recent Events Card */}
        <DashboardBlock id="recent_events" title={t('dashboard.recent_events')}>
          {recentEvents.length === 0 ? (
            <EmptyState>{t('events.empty')}</EmptyState>
          ) : (
            <ul className="event-list" style={{ fontSize: '0.8rem', height: '100%', overflowY: 'auto' }}>
              {recentEvents.slice(0, 10).map((event) => (
                <li key={event.id}>
                  <span className="event-kind">{t(`presence.${event.kind}`)}</span>
                  <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </DashboardBlock>

        {/* 3. Traffic Overview Card */}
        <DashboardBlock
          id="traffic_overview"
          title={
            <div className="card-header-with-tabs">
              <span>{t('dashboard.traffic_overview')}</span>
              <div className="client-tabs">
                <button
                  className={`tab-btn ${trafficTab === 'total' ? 'active' : ''}`}
                  onClick={() => setTrafficTab('total')}
                >
                  {t('dashboard.traffic_tab_total')}
                </button>
                <button
                  className={`tab-btn ${trafficTab === 'live' ? 'active' : ''}`}
                  onClick={() => setTrafficTab('live')}
                >
                  {t('dashboard.traffic_tab_live')}
                </button>
              </div>
            </div>
          }
        >
          <div className="traffic-overview-body">
            {trafficTab === 'total' ? (
              <>
                <UniFiDonutChart
                  segments={cumulativeSegments}
                  totalLabel={
                    totalIdentified > 0
                      ? t('dashboard.identified_traffic')
                      : t('dashboard.wan_traffic_total')
                  }
                  totalValue={formatBytes(displayTotalTraffic)}
                  formatValue={formatBytes}
                  size={150}
                  strokeWidth={14}
                />

                <div className="traffic-breakdown-table">
                  <div className="traffic-totals-chips">
                    <span className="chip down">↓ {formatBytes(totalDownload)}</span>
                    <span className="chip up">↑ {formatBytes(totalUpload)}</span>
                  </div>

                  <table className="traffic-table">
                    <thead>
                      <tr>
                        <th>{t('devices.name')}</th>
                        <th className="hide-on-compact">{t('dashboard.down')}</th>
                        <th className="hide-on-compact">{t('dashboard.up')}</th>
                        <th>{t('dashboard.traffic')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedByTraffic.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: '1rem' }}>
                            {t('dashboard.no_traffic_data')}
                          </td>
                        </tr>
                      ) : (
                        sortedByTraffic.slice(0, 8).map((d) => (
                          <tr
                            key={d.id}
                            className="clickable-device-row"
                            onClick={() => setSelectedDevice(d)}
                            title="Click to view device usage"
                          >
                            <td className="device-name-cell">
                              <span className="device-bullet" />
                              <span className="name">{d.name ?? d.mac ?? d.id}</span>
                            </td>
                            <td className="speed-cell hide-on-compact">{formatBytes(d.downloadTotal ?? 0)}</td>
                            <td className="speed-cell hide-on-compact">{formatBytes(d.uploadTotal ?? 0)}</td>
                            <td className="speed-cell highlight">
                              {formatBytes((d.downloadTotal ?? 0) + (d.uploadTotal ?? 0))}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <UniFiDonutChart
                  segments={liveSegments}
                  totalLabel={t('dashboard.live_throughput')}
                  totalValue={formatSpeed(liveThroughput)}
                  formatValue={formatSpeed}
                  size={150}
                  strokeWidth={14}
                />

                <div className="traffic-breakdown-table">
                  <div className="traffic-totals-chips">
                    <span className="chip down">↓ {formatSpeed(wanDownspeed)}</span>
                    <span className="chip up">↑ {formatSpeed(wanUpspeed)}</span>
                  </div>

                  <table className="traffic-table">
                    <thead>
                      <tr>
                        <th>{t('devices.name')}</th>
                        <th className="hide-on-compact">{t('dashboard.traffic_down_rate')}</th>
                        <th className="hide-on-compact">{t('dashboard.traffic_up_rate')}</th>
                        <th>{t('dashboard.traffic_total_rate')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedByLiveRate.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: '1rem' }}>
                            {t('dashboard.no_traffic_data')}
                          </td>
                        </tr>
                      ) : (
                        sortedByLiveRate.slice(0, 8).map((d) => {
                          const totalRate = (d.downspeed ?? 0) + (d.upspeed ?? 0);
                          return (
                            <tr
                              key={d.id}
                              className="clickable-device-row"
                              onClick={() => setSelectedDevice(d)}
                              title="Click to view device usage"
                            >
                              <td className="device-name-cell">
                                <span className="device-bullet" />
                                <span className="name">{d.name ?? d.mac ?? d.id}</span>
                              </td>
                              <td className="speed-cell hide-on-compact">{formatSpeed(d.downspeed ?? 0)}</td>
                              <td className="speed-cell hide-on-compact">{formatSpeed(d.upspeed ?? 0)}</td>
                              <td className="speed-cell highlight">{formatSpeed(totalRate)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </DashboardBlock>

        {/* 4. Client Device Types Card */}
        <DashboardBlock
          id="client_types"
          title={
            <div className="card-header-with-tabs">
              <span>{t('dashboard.client_types')}</span>
              <div className="client-tabs">
                <button
                  className={`tab-btn ${clientTab === 'all' ? 'active' : ''}`}
                  onClick={() => setClientTab('all')}
                >
                  {t('dashboard.tab_all')}
                </button>
                <button
                  className={`tab-btn ${clientTab === 'wired' ? 'active' : ''}`}
                  onClick={() => setClientTab('wired')}
                >
                  {t('dashboard.tab_wired')}
                </button>
                <button
                  className={`tab-btn ${clientTab === 'wireless' ? 'active' : ''}`}
                  onClick={() => setClientTab('wireless')}
                >
                  {t('dashboard.tab_wireless')}
                </button>
              </div>
            </div>
          }
        >
          <div className="clients-overview-body">
            <UniFiDonutChart
              segments={
                clientTab === 'all'
                  ? clientTypeSegments
                  : [
                      {
                        label: clientTab === 'wired' ? 'Wired' : 'Wireless',
                        value: filteredClientDevices.length,
                        color: clientTab === 'wired' ? '#2563eb' : '#10b981'
                      }
                    ]
              }
              totalLabel={
                clientTab === 'all'
                  ? t('dashboard.total_clients')
                  : clientTab === 'wired'
                    ? t('dashboard.tab_wired')
                    : t('dashboard.tab_wireless')
              }
              totalValue={String(
                clientTab === 'all'
                  ? (onlineCount ?? onlineDevices.length)
                  : filteredClientDevices.length
              )}
              size={150}
              strokeWidth={14}
            />

            <div className="client-types-breakdown">
              {clientTab === 'all' ? (
                <>
                  <div className="type-row">
                    <span className="type-dot wired" />
                    <span className="type-name">Wired (LAN)</span>
                    <span className="type-count">{wiredDevices.length}</span>
                  </div>
                  <div className="type-row">
                    <span className="type-dot wifi5" />
                    <span className="type-name">Wi-Fi 5 GHz</span>
                    <span className="type-count">{wifi5gDevices.length}</span>
                  </div>
                  <div className="type-row">
                    <span className="type-dot wifi2" />
                    <span className="type-name">Wi-Fi 2.4 GHz</span>
                    <span className="type-count">{wifi2gDevices.length}</span>
                  </div>
                  {guestDevices.length > 0 && (
                    <div className="type-row">
                      <span className="type-dot guest" />
                      <span className="type-name">Guest</span>
                      <span className="type-count">{guestDevices.length}</span>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {filteredClientDevices.slice(0, 6).map((d) => (
                    <div
                      key={d.id}
                      className="clickable-device-row"
                      onClick={() => setSelectedDevice(d)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '0.25rem 0.4rem',
                        borderRadius: '4px'
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{d.name ?? d.mac ?? d.id}</span>
                      <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--ok)' }}>
                        ↓ {formatSpeed(d.downspeed ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DashboardBlock>

        {/* 5. WiFi Clients Distribution */}
        <DashboardBlock id="wifi_clients" title={t('dashboard.wifi_clients')}>
          <WiFiBandBars
            wifi2gCount={wifi2gDevices.length}
            wifi5gCount={wifi5gDevices.length}
            wiredCount={wiredDevices.length}
            guestCount={guestDevices.length}
          />
        </DashboardBlock>

        {/* 6. Most Active Clients */}
        <DashboardBlock id="most_active_clients" title={t('dashboard.most_active_clients')}>
          {mostActiveClients.length === 0 ? (
            <EmptyState>{t('devices.empty')}</EmptyState>
          ) : (
            <div className="active-clients-carousel">
              {mostActiveClients.map((client) => {
                const totalRate = (client.downspeed ?? 0) + (client.upspeed ?? 0);
                return (
                  <div
                    key={client.id}
                    className="active-client-card"
                    onClick={() => setSelectedDevice(client)}
                    title="Click to view detailed usage"
                  >
                    <div className="client-avatar">
                      <ConnectionIcon connectionType={client.connectionType} size={22} />
                    </div>
                    <div className="client-info">
                      <span className="client-name">
                        {client.name ?? client.mac ?? client.id}
                      </span>
                      <span className="client-rate mono">
                        {totalRate > 0
                          ? `↓ ${formatSpeed(client.downspeed ?? 0)}`
                          : (client.downloadTotal ?? 0) + (client.uploadTotal ?? 0) > 0
                            ? `Idle (${formatBytes((client.downloadTotal ?? 0) + (client.uploadTotal ?? 0))})`
                            : 'Idle'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardBlock>

        {/* 7. Network Throughput History */}
        <DashboardBlock
          id="throughput_history"
          title={
            <div className="card-header-with-tabs">
              <span>{t('dashboard.throughput_history')}</span>
              <span className="chart-legend">
                <span className="legend-item down">
                  <span className="dot" /> Downlink
                </span>
                <span className="legend-item up">
                  <span className="dot" /> Uplink
                </span>
              </span>
            </div>
          }
        >
          <UniFiAreaChart data={timeseries} responsive range={range} />
        </DashboardBlock>
      </DashboardGrid>

      {/* Slide-over Device Usage Drawer */}
      {selectedDevice && (
        <DeviceUsageDrawer
          routerId={router.id}
          device={selectedDevice}
          onClose={() => setSelectedDevice(null)}
          canControl={router.capabilities.includes('device-internet-access-control')}
        />
      )}
    </div>
  );
}
