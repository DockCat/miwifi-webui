/**
 * Observability domain unit tests: device normalization, presence
 * transitions, reconciliation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deviceKey,
  normalizeDevice,
  normalizeDeviceList,
  normalizeRouterStatus,
  reconcilePresence,
  transitionForExisting
} from '../src/index.js';

describe('normalizeDevice', () => {
  it('normalizes a typical MiWiFi entry with traffic statistics', () => {
    const device = normalizeDevice({
      mac: 'aa:bb:cc:dd:ee:ff',
      name: 'living-room-tv',
      ip: '192.168.31.108',
      online: true,
      type: 2,
      statistics: {
        downspeed: '1048576',
        upspeed: '524288',
        download: '500000000',
        upload: '100000000'
      }
    });
    assert.deepEqual(device, {
      mac: 'AA:BB:CC:DD:EE:FF',
      name: 'living-room-tv',
      ip: '192.168.31.108',
      online: true,
      downspeed: 1048576,
      upspeed: 524288,
      downloadTotal: 500000000,
      downloadCounterAvailable: true,
      uploadTotal: 100000000,
      connectionType: 'wifi_5g'
    });
  });

  it('treats string "true"/"1" as online (firmware variance)', () => {
    assert.equal(normalizeDevice({ mac: 'A:1', online: 'true' })?.online, true);
    assert.equal(normalizeDevice({ mac: 'A:2', online: 1 })?.online, true);
    assert.equal(normalizeDevice({ mac: 'A:3', online: 'false' })?.online, false);
    assert.equal(normalizeDevice({ mac: 'A:4' })?.online, false);
  });

  it('prefers nickname when name is absent', () => {
    const device = normalizeDevice({ mac: 'A:5', nickname: 'phone' });
    assert.equal(device?.name, 'phone');
  });

  it('supports flat devname, download, upload, downspeed, upspeed fields', () => {
    const device = normalizeDevice({
      mac: '11:22:33:44:55:66',
      devname: 'my-laptop',
      ip: '192.168.31.200',
      download: '123456789',
      upload: '987654321',
      downspeed: '5000',
      upspeed: '2000',
      online: 1
    });
    assert.deepEqual(device, {
      mac: '11:22:33:44:55:66',
      name: 'my-laptop',
      ip: '192.168.31.200',
      online: true,
      downspeed: 5000,
      upspeed: 2000,
      downloadTotal: 123456789,
      downloadCounterAvailable: true,
      uploadTotal: 987654321,
      connectionType: 'unknown'
    });
  });

  it('rejects entries with neither mac nor ip', () => {
    assert.equal(normalizeDevice({ name: 'ghost' }), null);
    assert.equal(normalizeDevice({ mac: '', ip: '' }), null);
    assert.equal(normalizeDevice(null as never), null);
  });
});

describe('normalizeDeviceList', () => {
  it('extracts list from a MiWiFi-shaped payload', () => {
    const devices = normalizeDeviceList({
      code: 0,
      list: [
        { mac: 'AA:BB:CC:DD:EE:01', online: true, ip: '192.168.31.2' },
        { mac: 'AA:BB:CC:DD:EE:02', online: false }
      ]
    });
    assert.equal(devices.length, 2);
  });

  it('extracts list from a payload with dev array (firmware variance)', () => {
    const devices = normalizeDeviceList({
      code: 0,
      dev: [
        { mac: 'AA:BB:CC:DD:EE:03', devname: 'Tablet', download: '500', upload: '200', online: 1 }
      ]
    });
    assert.equal(devices.length, 1);
    assert.equal(devices[0]!.name, 'Tablet');
    assert.equal(devices[0]!.downloadTotal, 500);
    assert.equal(devices[0]!.uploadTotal, 200);
  });

  it('tolerates malformed payloads without throwing', () => {
    assert.deepEqual(normalizeDeviceList(null), []);
    assert.deepEqual(normalizeDeviceList('string'), []);
    assert.deepEqual(normalizeDeviceList({ code: 0 }), []);
    assert.deepEqual(normalizeDeviceList({ list: [null, 5, { name: 'no-ids' }] }), []);
  });
});

describe('normalizeRouterStatus', () => {
  it('parses numeric + wan fields defensively', () => {
    const status = normalizeRouterStatus({
      cpu: 23,
      mem: 45,
      memTotal: 128,
      wan: 'up',
      count: 7
    });
    assert.deepEqual(status, {
      cpuLoad: 23,
      cpuCore: undefined,
      cpuHz: undefined,
      memUsed: 45,
      memTotal: 128,
      memUsage: 35.2,
      memType: undefined,
      memHz: undefined,
      temperature: undefined,
      wanUp: true,
      deviceCount: 7,
      deviceCountOnline: undefined,
      deviceCountAll: undefined,
      wanDownspeed: undefined,
      wanUpspeed: undefined,
      wanMaxDownspeed: undefined,
      wanMaxUpspeed: undefined,
      wanDownloadTotal: undefined,
      wanUploadTotal: undefined,
      upTimeSeconds: undefined,
      hardwareInfo: undefined
    });
  });

  it('parses full upstream RACErace/MiWiFi-API misystem/status payload', () => {
    const upstream = {
      cpu: {
        core: 4,
        hz: '1.0GHz',
        load: 0.09
      },
      mem: {
        type: 'DDR3',
        usage: 0.43,
        total: '256MB',
        hz: '1200MHz'
      },
      temperature: 45,
      count: {
        all: 3,
        online: 2,
        all_without_mash: 3,
        online_without_mash: 2
      },
      wan: {
        downspeed: '1048576',
        upspeed: '524288',
        maxdownloadspeed: '10485760',
        maxuploadspeed: '5242880',
        upload: '77491757',
        download: '469335436'
      },
      hardware: {
        mac: 'AA:BB:CC:DD:EE:FF',
        platform: 'R3D',
        version: '2.26.11',
        channel: 'release',
        sn: '12345/6789',
        DisplayRomVer: '2.26.11',
        displayName: '小米路由器HD'
      },
      upTime: '151877',
      code: 0
    };

    const status = normalizeRouterStatus(upstream);
    assert.equal(status.cpuLoad, 9);
    assert.equal(status.cpuCore, 4);
    assert.equal(status.cpuHz, '1.0GHz');
    assert.equal(status.memUsed, 110);
    assert.equal(status.memTotal, 256);
    assert.equal(status.memUsage, 43);
    assert.equal(status.memType, 'DDR3');
    assert.equal(status.memHz, '1200MHz');
    assert.equal(status.temperature, 45);
    assert.equal(status.deviceCount, 2);
    assert.equal(status.deviceCountOnline, 2);
    assert.equal(status.deviceCountAll, 3);
    assert.equal(status.wanUp, true);
    assert.equal(status.wanDownspeed, 1048576);
    assert.equal(status.wanUpspeed, 524288);
    assert.equal(status.wanMaxDownspeed, 10485760);
    assert.equal(status.wanMaxUpspeed, 5242880);
    assert.equal(status.wanDownloadTotal, 469335436);
    assert.equal(status.wanUploadTotal, 77491757);
    assert.equal(status.upTimeSeconds, 151877);
    assert.deepEqual(status.hardwareInfo, {
      mac: 'AA:BB:CC:DD:EE:FF',
      platform: 'R3D',
      version: '2.26.11',
      channel: 'release',
      sn: '12345/6789',
      displayRomVer: '2.26.11',
      displayName: '小米路由器HD'
    });
  });

  it('supports temperature 0 or missing gracefully', () => {
    const status1 = normalizeRouterStatus({ temperature: 0 });
    assert.equal(status1.temperature, 0);

    const status2 = normalizeRouterStatus({ temp: 38 });
    assert.equal(status2.temperature, 38);

    const status3 = normalizeRouterStatus({});
    assert.equal(status3.temperature, undefined);
  });

  it('parses RD05-style wanStatistics + uptime payloads', () => {
    const status = normalizeRouterStatus({
      count: 7,
      upTime: '757601.79',
      wanStatistics: { downspeed: '1335', upspeed: '1052' }
    });
    assert.equal(status.deviceCount, 7);
    assert.equal(status.upTimeSeconds, 757601.79);
    assert.equal(status.wanDownspeed, 1335);
    assert.equal(status.wanUpspeed, 1052);
    assert.equal(status.wanUp, true, 'live WAN statistics imply link up');
  });

  it('extracts active devices from status dev array when present', () => {
    const status = normalizeRouterStatus({
      cpu: 10,
      dev: [
        {
          mac: 'AA:11:22:33:44:55',
          devname: 'Living Room TV',
          download: '4000000',
          upload: '1000000',
          downspeed: '2500',
          upspeed: '500'
        }
      ]
    });
    assert.ok(status.devices);
    assert.equal(status.devices.length, 1);
    assert.equal(status.devices[0]!.name, 'Living Room TV');
    assert.equal(status.devices[0]!.downloadTotal, 4000000);
    assert.equal(status.devices[0]!.uploadTotal, 1000000);
    assert.equal(status.devices[0]!.downspeed, 2500);
    assert.equal(status.devices[0]!.upspeed, 500);
    assert.equal(status.devices[0]!.online, true);
  });

  it('returns undefined fields for garbage payloads', () => {
    const status = normalizeRouterStatus({ cpu: 'abc', wan: 42 });
    assert.equal(status.cpuLoad, undefined);
    assert.equal(status.wanUp, undefined);
  });
});

describe('presence transitions', () => {
  it('emits ONLINE/OFFLINE only on actual changes', () => {
    assert.deepEqual(transitionForExisting({ online: false }, true), { kind: 'ONLINE' });
    assert.deepEqual(transitionForExisting({ online: true }, false), { kind: 'OFFLINE' });
    assert.equal(transitionForExisting({ online: true }, true), null);
    assert.equal(transitionForExisting({ online: false }, false), null);
  });
});

describe('reconcilePresence', () => {
  it('computes FIRST_SEEN, ONLINE, OFFLINE and skips no-ops', () => {
    const observed = new Map([
      ['mac:A:1', { online: true }],   // new, online -> FIRST_SEEN
      ['mac:A:2', { online: true }],   // stored offline -> ONLINE
      ['mac:A:3', { online: true }],   // unchanged -> nothing
      ['mac:A:4', { online: false }]    // new but offline -> nothing
    ]);
    const stored = new Map([
      ['mac:A:2', { online: false }],
      ['mac:A:3', { online: true }],
      ['mac:A:9', { online: true }]     // missing from pass -> OFFLINE
    ]);
    const { events } = reconcilePresence(observed, stored);
    const kinds = events.map((e) => `${e.key}:${e.kind}`).sort();
    assert.deepEqual(kinds, [
      'mac:A:1:FIRST_SEEN',
      'mac:A:2:ONLINE',
      'mac:A:9:OFFLINE'
    ]);
  });

  it('deviceKey prefers mac, falls back to ip, rejects empty', () => {
    assert.equal(deviceKey('AA:1', '192.0.2.1'), 'mac:AA:1');
    assert.equal(deviceKey(undefined, '192.0.2.1'), 'ip:192.0.2.1');
    assert.equal(deviceKey(undefined, undefined), null);
  });
});


it('distinguishes missing download counters from measured zero', () => {
  assert.equal(normalizeDevice({ mac: 'AA:BB:CC:DD:EE:01' })?.downloadCounterAvailable, false);
  assert.equal(normalizeDevice({ mac: 'AA:BB:CC:DD:EE:01', download: 0 })?.downloadCounterAvailable, true);
  assert.equal(normalizeDevice({ mac: 'AA:BB:CC:DD:EE:01', download: -1 })?.downloadCounterAvailable, false);
});
