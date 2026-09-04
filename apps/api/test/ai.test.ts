/**
 * AI layer tests (Task 0007).
 *
 * Security-focused: tools reject out-of-range inputs; pseudonymizer
 * redacts; provider disabled by default; the tool registry contains no
 * mutation tools; secret shapes never survive egress.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AliasMap,
  DEFAULT_PRIVACY,
  deviceNameFor,
  pseudonymize
} from '../src/ai/privacy.js';
import {
  INVESTIGATION_TOOLS,
  runTool,
  auditHistoryTool,
  deviceStateTool,
  evidenceLookupTool,
  presenceHistoryTool,
  routerStatusTool
} from '../src/ai/tools.js';
import { DISABLED_PROVIDER, loadProviderConfig } from '../src/ai/provider.js';
import process from 'node:process';

describe('provider default state', () => {
  it('is disabled without environment configuration', () => {
    for (const key of [
      'AI_PROVIDER_MODE',
      'AI_PROVIDER_BASE_URL',
      'AI_PROVIDER_MODEL',
      'AI_PROVIDER_API_KEY'
    ]) {
      delete process.env[key];
    }
    assert.deepEqual(loadProviderConfig(), DISABLED_PROVIDER);
    assert.equal(loadProviderConfig().mode, 'disabled');
  });

  it('local mode requires base url and model', () => {
    process.env.AI_PROVIDER_MODE = 'local';
    delete process.env.AI_PROVIDER_BASE_URL;
    assert.equal(loadProviderConfig().mode, 'disabled');
    process.env.AI_PROVIDER_BASE_URL = 'http://localhost:11434/v1';
    process.env.AI_PROVIDER_MODEL = 'qwen3:8b';
    const config = loadProviderConfig();
    assert.equal(config.mode, 'local');
    // Local mode passes identifiers through by default.
    assert.equal(config.privacy.allowMac, true);
    delete process.env.AI_PROVIDER_MODE;
    delete process.env.AI_PROVIDER_BASE_URL;
    delete process.env.AI_PROVIDER_MODEL;
  });

  it('external mode pseudonymizes by default', () => {
    process.env.AI_PROVIDER_MODE = 'external';
    process.env.AI_PROVIDER_BASE_URL = 'https://api.example.com/v1';
    process.env.AI_PROVIDER_MODEL = 'gpt-test';
    const config = loadProviderConfig();
    assert.equal(config.mode, 'external');
    assert.equal(config.privacy.allowMac, false);
    assert.equal(config.privacy.allowIp, false);
    assert.equal(config.privacy.allowNames, false);
    delete process.env.AI_PROVIDER_MODE;
    delete process.env.AI_PROVIDER_BASE_URL;
    delete process.env.AI_PROVIDER_MODEL;
  });
});

describe('tool registry', () => {
  it('contains exactly the five read-only tools', () => {
    assert.deepEqual(
      INVESTIGATION_TOOLS.map((tool) => tool.name),
      [
        'router_status',
        'device_state',
        'presence_history',
        'audit_history',
        'evidence_lookup'
      ]
    );
    // No mutation tool can exist in the registry.
    for (const tool of INVESTIGATION_TOOLS) {
      assert.ok(!tool.name.includes('block'), 'no block tool');
      assert.ok(!tool.name.includes('unblock'), 'no unblock tool');
      assert.ok(!tool.name.includes('reboot'), 'no reboot tool');
      assert.ok(!tool.name.includes('reset'), 'no reset tool');
      assert.ok(!tool.name.includes('wifi'), 'no wifi tool');
    }
  });

  it('rejects out-of-range limits and windows', () => {
    assert.equal(routerStatusTool.validate({ limit: 0 }), null);
    assert.equal(routerStatusTool.validate({ limit: 51 }), null);
    assert.equal(routerStatusTool.validate({ limit: 'nope' }), null);
    assert.equal(routerStatusTool.validate(null), null);
    assert.deepEqual(routerStatusTool.validate({ limit: 10 }), { limit: 10 });

    const farPast = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    assert.equal(presenceHistoryTool.validate({ since: farPast, limit: 5 }), null);
    const recent = new Date(Date.now() - 60 * 60 * 1000);
    assert.ok(presenceHistoryTool.validate({ since: recent.toISOString(), limit: 5 }));

    assert.equal(auditHistoryTool.validate({ since: 'not-a-date' }), null);
    assert.equal(evidenceLookupTool.validate({ evidenceKind: 'bogus', evidenceId: '1' }), null);
    assert.equal(
      evidenceLookupTool.validate({ evidenceKind: 'device', evidenceId: '' }),
      null
    );
  });

  it('runTool returns null for unknown tool names (no escape hatch)', () => {
    const ctx = { pool: {} as never, routerId: 'r1' };
    assert.equal(runTool(ctx, 'block_internet', {}), null);
    assert.equal(runTool(ctx, 'arbitrary_sql', {}), null);
    assert.equal(runTool(ctx, 'exec', {}), null);
  });

  it('device_state validation bounds', () => {
    assert.equal(deviceStateTool.validate({ limit: 999 }), null);
    assert.deepEqual(deviceStateTool.validate({ limit: 50 }), { limit: 50 });
  });
});

describe('pseudonymization', () => {
  it('aliases MACs and IPs by default', () => {
    const aliases = new AliasMap();
    const result = pseudonymize(
      {
        mac: 'AA:BB:CC:DD:EE:01',
        ip: '192.168.31.108',
        note: 'device AA:BB:CC:DD:EE:01 seen at 192.168.31.108'
      },
      DEFAULT_PRIVACY,
      aliases
    ) as { mac: string; ip: string; note: string };
    assert.ok(!result.mac.includes('AA:BB'), 'mac aliased');
    assert.ok(!result.ip.includes('192.'), 'ip aliased');
    assert.ok(!result.note.includes('AA:BB:CC:DD:EE:01'), 'mac scrubbed from strings');
    assert.ok(!result.note.includes('192.168.31.108'), 'ip scrubbed from strings');
    assert.ok(result.note.includes('device_01'), 'alias present');
  });

  it('keeps identifiers when the category is allowed', () => {
    const aliases = new AliasMap();
    const config = { allowMac: true, allowIp: true, allowNames: false };
    const result = pseudonymize(
      { mac: 'AA:BB:CC:DD:EE:02', ip: '10.0.0.5' },
      config,
      aliases
    ) as { mac: string; ip: string };
    assert.equal(result.mac, 'AA:BB:CC:DD:EE:02');
    assert.equal(result.ip, '10.0.0.5');
  });

  it('redacts secret-shaped keys and values regardless of config', () => {
    const aliases = new AliasMap();
    const allowAll = { allowMac: true, allowIp: true, allowNames: true };
    const result = pseudonymize(
      {
        stok: 'abc123',
        api_key: 'xyz',
        password: 'hunter2',
        url: 'http://router/cgi-bin/luci/api/xqsystem/stok=SECRETTOKEN/router_info'
      },
      allowAll,
      aliases
    ) as Record<string, string>;
    assert.equal(result['stok'], '[redacted]');
    assert.equal(result['api_key'], '[redacted]');
    assert.equal(result['password'], '[redacted]');
    assert.ok(result['url'] !== undefined && !result['url'].includes('SECRETTOKEN'), 'stok in url redacted');
  });

  it('assigns stable aliases for the same value', () => {
    const aliases = new AliasMap();
    const first = aliases.aliasFor('device', 'AA:BB:CC:DD:EE:03');
    const second = aliases.aliasFor('device', 'aa:bb:cc:dd:ee:03');
    const third = aliases.aliasFor('device', 'AA:BB:CC:DD:EE:04');
    assert.equal(first, second, 'case-insensitive identity');
    assert.notEqual(first, third);
  });

  it('deviceNameFor pseudonymizes raw names by default', () => {
    const aliases = new AliasMap();
    assert.equal(deviceNameFor('living-room-tv', 'd-1', DEFAULT_PRIVACY, aliases), 'device_01');
    const allow = { allowMac: false, allowIp: false, allowNames: true };
    assert.equal(deviceNameFor('living-room-tv', 'd-1', allow, aliases), 'living-room-tv');
  });
});
