/**
 * Devices table render test with fixture data (Task 0005 acceptance).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { DevicesView } from '../src/views/DevicesView.js';
import type { RouterSummary } from '../src/api.js';

const ROUTER: RouterSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  host: '192.168.31.1',
  model: 'RD03',
  hardware: 'RD03',
  romVersion: '2.28.23',
  compatibility: 'SUPPORTED',
  capabilities: ['router-info', 'device-inventory'],
  lastProbedAt: '2026-09-05T00:00:00Z'
};

const DEVICES = [
  {
    id: 'd1',
    mac: 'AA:BB:CC:DD:EE:01',
    name: 'living-room-tv',
    ip: '192.168.31.108',
    online: true,
    internetAccess: true,
    firstSeenAt: '2026-09-04T10:00:00Z',
    lastSeenAt: '2026-09-05T12:00:00Z'
  },
  {
    id: 'd2',
    mac: 'AA:BB:CC:DD:EE:02',
    name: 'phone',
    ip: '192.168.31.109',
    online: false,
    internetAccess: true,
    firstSeenAt: '2026-09-04T11:00:00Z',
    lastSeenAt: '2026-09-04T23:00:00Z'
  }
] as const;

describe('DevicesView table', () => {
  it('renders rows from fixture data with status text not color-only', () => {
    const markup = renderToStaticMarkup(
      createElement(DevicesView, {
        router: ROUTER,
        initialDevices: [...DEVICES],
        onOpenDevice: () => undefined
      })
    );
    assert.ok(markup.includes('living-room-tv'), 'device name row');
    assert.ok(markup.includes('phone'), 'second device row');
    assert.ok(markup.includes('Online'), 'online label as text');
    assert.ok(markup.includes('Offline'), 'offline label as text');
    assert.ok(markup.includes('192.168.31.108'), 'IP column');
    assert.ok(markup.includes('AA:BB:CC:DD:EE:01'), 'MAC column');
  });

  it('renders the empty state when no devices', () => {
    const markup = renderToStaticMarkup(
      createElement(DevicesView, {
        router: ROUTER,
        initialDevices: [],
        onOpenDevice: () => undefined
      })
    );
    assert.ok(markup.includes('No devices observed yet'));
  });
});
