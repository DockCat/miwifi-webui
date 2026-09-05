/**
 * UniFi Dashboard and native SVG chart tests.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { DashboardView } from '../src/views/DashboardView.js';
import { UniFiDonutChart } from '../src/components/charts/UniFiDonutChart.js';
import { UniFiAreaChart, formatSpeed } from '../src/components/charts/UniFiAreaChart.js';
import { UniFiUtilizationGauge, WiFiBandBars } from '../src/components/charts/UniFiBarGauge.js';
import { DeviceUsageDrawer, formatBytes } from '../src/components/DeviceUsageDrawer.js';
import type { RouterSummary, DeviceRow, TimeseriesPoint } from '../src/api.js';

const ROUTER: RouterSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  host: '192.168.31.1',
  model: 'AX6000',
  hardware: 'RB06',
  romVersion: '1.0.60',
  compatibility: 'SUPPORTED',
  capabilities: ['router-info', 'device-inventory', 'device-internet-access-control'],
  lastProbedAt: '2026-09-05T00:00:00Z'
};

const SAMPLE_DEVICE: DeviceRow = {
  id: 'dev-1',
  mac: '64:90:C1:11:22:33',
  name: 'MacBook Pro',
  ip: '192.168.31.150',
  online: true,
  internetAccess: true,
  firstSeenAt: '2026-09-01T08:00:00Z',
  lastSeenAt: '2026-09-05T15:00:00Z',
  downspeed: 5242880, // 5 MB/s
  upspeed: 1048576,  // 1 MB/s
  downloadTotal: 10737418240, // 10 GB
  uploadTotal: 2147483648,   // 2 GB
  connectionType: 'wifi_5g'
};

const SAMPLE_TIMESERIES: TimeseriesPoint[] = [
  {
    timestamp: '2026-09-05T12:00:00Z',
    downspeed: 10485760,
    upspeed: 2097152,
    deviceCount: 12,
    cpuLoad: 25,
    memUsed: 150
  },
  {
    timestamp: '2026-09-05T12:05:00Z',
    downspeed: 20971520,
    upspeed: 4194304,
    deviceCount: 14,
    cpuLoad: 35,
    memUsed: 160
  }
];

describe('UniFi Dashboard components', () => {
  it('renders DashboardView empty state when router is null', () => {
    const markup = renderToStaticMarkup(createElement(DashboardView, { router: null }));
    assert.ok(markup.includes('No router onboarded yet'));
  });

  it('renders DashboardView shell with UniFi layout when router is provided', () => {
    const markup = renderToStaticMarkup(createElement(DashboardView, { router: ROUTER }));
    assert.ok(markup.includes('AX6000'));
    assert.ok(markup.includes('Traffic Overview'));
    assert.ok(markup.includes('Client Device Types'));
    assert.ok(markup.includes('WiFi Clients'));
    assert.ok(markup.includes('Down Utilization'));
  });

  it('renders UniFiDonutChart with segments and center totals', () => {
    const markup = renderToStaticMarkup(
      createElement(UniFiDonutChart, {
        segments: [
          { label: 'MacBook', value: 100, color: '#006fff' },
          { label: 'iPhone', value: 50, color: '#10b981' }
        ],
        totalLabel: 'Identified Traffic',
        totalValue: '150 GB'
      })
    );
    assert.ok(markup.includes('donut-segment'));
    assert.ok(markup.includes('Identified Traffic'));
    assert.ok(markup.includes('150 GB'));
  });

  it('renders UniFiAreaChart with SVG paths and gradient definitions', () => {
    const markup = renderToStaticMarkup(
      createElement(UniFiAreaChart, {
        data: SAMPLE_TIMESERIES,
        height: 200,
        range: '1d'
      })
    );
    assert.ok(markup.includes('<linearGradient'));
    assert.ok(markup.includes('<path'));
    assert.ok(markup.includes('unifi-area-chart-svg'));
  });

  it('renders UniFiUtilizationGauge and WiFiBandBars correctly', () => {
    const gaugeMarkup = renderToStaticMarkup(
      createElement(UniFiUtilizationGauge, {
        label: 'Down Utilization',
        speed: 1048576,
        variant: 'down'
      })
    );
    assert.ok(gaugeMarkup.includes('Down Utilization'));
    assert.ok(gaugeMarkup.includes('1.0 MB/s'));

    const barMarkup = renderToStaticMarkup(
      createElement(WiFiBandBars, {
        wifi2gCount: 4,
        wifi5gCount: 8,
        wiredCount: 2
      })
    );
    assert.ok(barMarkup.includes('2.4 GHz'));
    assert.ok(barMarkup.includes('5 GHz'));
    assert.ok(barMarkup.includes('LAN'));
  });

  it('renders DeviceUsageDrawer with live rates and total bytes', () => {
    const markup = renderToStaticMarkup(
      createElement(DeviceUsageDrawer, {
        routerId: ROUTER.id,
        device: SAMPLE_DEVICE,
        onClose: () => undefined
      })
    );
    assert.ok(markup.includes('MacBook Pro'));
    assert.ok(markup.includes('64:90:C1:11:22:33'));
    assert.ok(markup.includes('5.0 MB/s'));
    assert.ok(markup.includes('1.0 MB/s'));
    assert.ok(markup.includes('10.00 GB'));
  });

  it('formats speeds and byte quantities correctly', () => {
    assert.equal(formatSpeed(0), '0 B/s');
    assert.equal(formatSpeed(1024), '1.0 KB/s');
    assert.equal(formatSpeed(10485760), '10.0 MB/s');

    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(2048), '2.0 KB');
    assert.equal(formatBytes(52428800), '50.00 MB');
    assert.equal(formatBytes(10737418240), '10.00 GB');
  });
});
