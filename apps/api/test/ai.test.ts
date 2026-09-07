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
  EXTERNAL_PRIVACY,
  LOCAL_PRIVACY,
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
  routerStatusTool,
  type ToolContext
} from '../src/ai/tools.js';
import { DISABLED_PROVIDER, loadProviderConfig, runInvestigation, extractProviderErrorMessage } from '../src/ai/provider.js';
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
    // Local mode passes identifiers through (endpoint is the admin's own machine).
    assert.equal(config.privacy.allowMac, true);
    assert.equal(config.privacy.allowIp, true);
    assert.equal(config.privacy.allowNames, true);
    delete process.env.AI_PROVIDER_MODE;
    delete process.env.AI_PROVIDER_BASE_URL;
    delete process.env.AI_PROVIDER_MODEL;
  });

  it('external mode pseudonymizes by default and has no opt-out switches', () => {
    process.env.AI_PROVIDER_MODE = 'external';
    process.env.AI_PROVIDER_BASE_URL = 'https://api.example.com/v1';
    process.env.AI_PROVIDER_MODEL = 'gpt-test';
    // Even if legacy egress switches linger in some environment, they are
    // ignored: external mode is always fully pseudonymized.
    process.env.AI_EGRESS_ALLOW_MAC = 'true';
    process.env.AI_EGRESS_ALLOW_IP = 'true';
    process.env.AI_EGRESS_ALLOW_NAMES = 'true';
    const config = loadProviderConfig();
    assert.equal(config.mode, 'external');
    assert.equal(config.privacy.allowMac, false);
    assert.equal(config.privacy.allowIp, false);
    assert.equal(config.privacy.allowNames, false);
    delete process.env.AI_PROVIDER_MODE;
    delete process.env.AI_PROVIDER_BASE_URL;
    delete process.env.AI_PROVIDER_MODEL;
    delete process.env.AI_EGRESS_ALLOW_MAC;
    delete process.env.AI_EGRESS_ALLOW_IP;
    delete process.env.AI_EGRESS_ALLOW_NAMES;
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
    const ctx = {
      pool: {} as never,
      routerId: 'r1',
      privacy: EXTERNAL_PRIVACY,
      aliases: new AliasMap()
    };
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
      EXTERNAL_PRIVACY,
      aliases
    ) as { mac: string; ip: string; note: string };
    assert.ok(!result.mac.includes('AA:BB'), 'mac aliased');
    assert.ok(!result.ip.includes('192.'), 'ip aliased');
    assert.ok(!result.note.includes('AA:BB:CC:DD:EE:01'), 'mac scrubbed from strings');
    assert.ok(!result.note.includes('192.168.31.108'), 'ip scrubbed from strings');
    assert.ok(result.note.includes('device_01'), 'alias present');
  });

  it('keeps identifiers when the mode is local', () => {
    const aliases = new AliasMap();
    const result = pseudonymize(
      { mac: 'AA:BB:CC:DD:EE:02', ip: '10.0.0.5' },
      LOCAL_PRIVACY,
      aliases
    ) as { mac: string; ip: string };
    assert.equal(result.mac, 'AA:BB:CC:DD:EE:02');
    assert.equal(result.ip, '10.0.0.5');
  });

  it('pseudonymizes device names by key in external mode (nested included)', () => {
    const aliases = new AliasMap();
    const result = pseudonymize(
      {
        name: 'living-room-tv',
        nested: { name: 'SEN[1]TINEL-Device-Name', other: 'plain text' }
      },
      EXTERNAL_PRIVACY,
      aliases
    ) as { name: string; nested: { name: string; other: string } };
    assert.ok(!result.name.includes('living-room'), 'outer name aliased');
    assert.ok(!result.nested.name.includes('SEN[1]TINEL'), 'nested name aliased');
    assert.equal(result.nested.other, 'plain text', 'non-name fields untouched');
  });

  it('keeps names in local mode', () => {
    const aliases = new AliasMap();
    const result = pseudonymize(
      { name: 'living-room-tv' },
      LOCAL_PRIVACY,
      aliases
    ) as { name: string };
    assert.equal(result.name, 'living-room-tv');
  });

  it('redacts secret-shaped keys and values regardless of config', () => {
    const aliases = new AliasMap();
    const result = pseudonymize(
      {
        stok: 'abc123',
        api_key: 'xyz',
        password: 'hunter2',
        url: 'http://router/cgi-bin/luci/api/xqsystem/stok=SECRETTOKEN/router_info'
      },
      LOCAL_PRIVACY,
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

  it('deviceNameFor pseudonymizes raw names in external mode', () => {
    const aliases = new AliasMap();
    assert.equal(
      deviceNameFor('living-room-tv', 'd-1', EXTERNAL_PRIVACY, aliases),
      'device_01'
    );
    assert.equal(
      deviceNameFor('living-room-tv', 'd-1', LOCAL_PRIVACY, aliases),
      'living-room-tv'
    );
  });

  it('AliasMap.legend() exposes the alias -> original mapping', () => {
    const aliases = new AliasMap();
    aliases.aliasFor('device', 'AA:BB:CC:DD:EE:03');
    aliases.aliasFor('device', '192.168.31.5');
    aliases.aliasFor('router', '192.168.31.1');
    const legend = aliases.legend();
    assert.equal(legend.length, 3);
    // Sorted by alias for stable display.
    assert.deepEqual(
      legend.map((e) => e.alias),
      ['device_01', 'device_02', 'router_03']
    );
    assert.ok(legend.some((e) => e.original === 'AA:BB:CC:DD:EE:03'));
    assert.ok(legend.some((e) => e.original === '192.168.31.1'));
  });
});

describe('name pseudonymization at the tool layer (M-1)', () => {
  /** Recognizable sentinel so accidental name egress is detectable. */
  const SENTINEL_NAME = 'SEN[1]TINEL-Device-Name';

  function toolContext(
    privacy: typeof EXTERNAL_PRIVACY | typeof LOCAL_PRIVACY
  ): ToolContext {
    // Mock pool keyed on the actual tool SQL fragments.
    const pool = {
      query: async (text: string) => {
        // device_state: "... FROM device WHERE router_id = $1 ORDER BY online DESC ..."
        if (text.includes('ORDER BY online DESC')) {
          return {
            rows: [
              {
                id: 'dev-sentinel',
                name: SENTINEL_NAME,
                online: true,
                internetAccess: true,
                lastSeenAt: new Date()
              }
            ]
          };
        }
        // evidence_lookup (device): "SELECT name, mac, online FROM device WHERE id = $1::uuid ..."
        if (text.includes('SELECT name, mac, online FROM device')) {
          return {
            rows: [
              {
                name: SENTINEL_NAME,
                mac: 'AA:BB:CC:DD:EE:FF',
                online: true
              }
            ]
          };
        }
        return { rows: [] };
      }
    };
    return {
      pool: pool as never,
      routerId: 'router-1',
      privacy,
      aliases: new AliasMap()
    };
  }

  it('device_state never emits raw names in external mode', async () => {
    const ctx = toolContext(EXTERNAL_PRIVACY);
    const validated = deviceStateTool.validate({ limit: 5 });
    assert.ok(validated);
    const output = await deviceStateTool.execute(ctx, validated);
    const blob = JSON.stringify(output);
    assert.ok(!blob.includes(SENTINEL_NAME), 'raw name must not leave the tool');
    assert.ok(blob.includes('device_'), 'alias present instead');
  });

  it('device_state keeps names in local mode', async () => {
    const ctx = toolContext(LOCAL_PRIVACY);
    const validated = deviceStateTool.validate({ limit: 5 });
    assert.ok(validated);
    const output = await deviceStateTool.execute(ctx, validated);
    assert.ok(JSON.stringify(output).includes(SENTINEL_NAME));
  });

  it('evidence_lookup device summary never emits raw names in external mode', async () => {
    const ctx = toolContext(EXTERNAL_PRIVACY);
    const validated = evidenceLookupTool.validate({
      evidenceKind: 'device',
      evidenceId: 'dev-sentinel'
    });
    assert.ok(validated);
    const output = await evidenceLookupTool.execute(ctx, validated);
    const blob = JSON.stringify(output);
    assert.ok(!blob.includes(SENTINEL_NAME), 'raw name must not leave the tool');
  });

  it('aliases stay consistent between tool calls for the same device', async () => {
    const ctx = toolContext(EXTERNAL_PRIVACY);
    const stateValidated = deviceStateTool.validate({ limit: 5 });
    const lookupValidated = evidenceLookupTool.validate({
      evidenceKind: 'device',
      evidenceId: 'dev-sentinel'
    });
    assert.ok(stateValidated && lookupValidated);
    const state = await deviceStateTool.execute(ctx, stateValidated);
    const lookup = await evidenceLookupTool.execute(ctx, lookupValidated);
    // Both must reference the same alias for the same device id.
    const stateAlias = (state.devices[0] as { name: string }).name;
    const lookupMatch = /device_\d+/.exec(JSON.stringify(lookup));
    assert.ok(lookupMatch, 'lookup summary uses an alias');
    assert.equal(stateAlias, lookupMatch[0], 'same alias across tools');
  });
});

describe('alias legend in investigation results', () => {
  it('runInvestigation returns the legend for pseudonymized egress', async () => {
    // Minimal in-process provider: responds with a plain finding so the
    // loop exits on the first iteration. The question contains identifiers
    // that external mode must alias — and the legend must recover them.
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
      calls.push(String(init?.body ?? ''));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'finding: device_01 was offline' } }] }),
        { status: 200 }
      );
    }) as typeof fetch;
    try {
      const result = await runInvestigation(
        {
          mode: 'external',
          baseUrl: 'http://provider.test/v1',
          apiKey: null,
          model: 'test-model',
          privacy: EXTERNAL_PRIVACY
        },
        {
          pool: { query: async () => ({ rows: [] }) } as never,
          routerId: 'router-1'
        },
        'Why did 192.168.31.108 (AA:BB:CC:DD:EE:01) disconnect at 14:32?'
      );
      // Egress was pseudonymized...
      assert.ok(!calls.join('\n').includes('192.168.31.108'), 'no raw IP sent');
      assert.ok(!calls.join('\n').includes('AA:BB:CC:DD:EE:01'), 'no raw MAC sent');
      // ...and the legend maps the aliases back to the originals. IPs carry
      // an ip: prefix key in the legend (they share the device alias space).
      assert.ok(result.aliasLegend.some((e) => e.original === 'ip:192.168.31.108'));
      assert.ok(result.aliasLegend.some((e) => e.original === 'AA:BB:CC:DD:EE:01'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('extractProviderErrorMessage', () => {
  it('extracts error.message from OpenAI-style JSON', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: 'credit insufficient balance: balance=0 required=708',
          code: 'insufficient_user_quota'
        }
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
    const msg = await extractProviderErrorMessage(response);
    assert.equal(msg, 'credit insufficient balance: balance=0 required=708');
  });

  it('extracts top-level message string from JSON', async () => {
    const response = new Response(
      JSON.stringify({ message: 'Rate limit exceeded' }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    );
    const msg = await extractProviderErrorMessage(response);
    assert.equal(msg, 'Rate limit exceeded');
  });

  it('extracts plain text response fallback', async () => {
    const response = new Response('503 Service Temporarily Unavailable\nretry later', {
      status: 503,
      headers: { 'content-type': 'text/plain' }
    });
    const msg = await extractProviderErrorMessage(response);
    assert.equal(msg, '503 Service Temporarily Unavailable retry later');
  });

  it('returns empty string on empty body', async () => {
    const response = new Response('', { status: 500 });
    const msg = await extractProviderErrorMessage(response);
    assert.equal(msg, '');
  });
});
