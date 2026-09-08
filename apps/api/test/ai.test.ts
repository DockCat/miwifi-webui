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
  dashboardSummaryTool,
  deviceStateTool,
  evidenceLookupTool,
  presenceHistoryTool,
  routerStatusTool,
  telemetryTimeseriesTool,
  deviceTrafficUsageTool,
  type ToolContext
} from '../src/ai/tools.js';
import {
  DISABLED_PROVIDER,
  loadProviderConfig,
  runInvestigation,
  extractProviderErrorMessage,
  systemPromptFor,
  requiredToolFor
} from '../src/ai/provider.js';
import { historyFromInvestigations } from '../src/routes/investigations.js';
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

  it('external mode pseudonymizes by default and legacy switches are ignored', () => {
    process.env.AI_PROVIDER_MODE = 'external';
    process.env.AI_PROVIDER_BASE_URL = 'https://api.example.com/v1';
    process.env.AI_PROVIDER_MODEL = 'gpt-test';
    // Even if legacy egress switches linger in some environment, they are
    // ignored: external mode is fully pseudonymized without the explicit
    // names opt-in.
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

  it('external mode ignores the removed names opt-out', () => {
    process.env.AI_PROVIDER_MODE = 'external';
    process.env.AI_PROVIDER_BASE_URL = 'https://api.example.com/v1';
    process.env.AI_PROVIDER_MODEL = 'gpt-test';

    // This legacy variable must not weaken the egress boundary.
    process.env.AI_EXTERNAL_SEND_NAMES = 'true';
    let config = loadProviderConfig();
    assert.equal(config.privacy.allowNames, false);
    assert.equal(config.privacy.allowMac, false, 'MAC never opt-out-able');
    assert.equal(config.privacy.allowIp, false, 'IP never opt-out-able');

    // Any other value keeps the default: everything aliased.
    process.env.AI_EXTERNAL_SEND_NAMES = 'false';
    config = loadProviderConfig();
    assert.equal(config.privacy.allowNames, false);

    delete process.env.AI_EXTERNAL_SEND_NAMES;
    delete process.env.AI_PROVIDER_MODE;
    delete process.env.AI_PROVIDER_BASE_URL;
    delete process.env.AI_PROVIDER_MODEL;
  });
});

describe('tool registry', () => {
  it('contains exactly the eight read-only tools', () => {
    assert.deepEqual(
      INVESTIGATION_TOOLS.map((tool) => tool.name),
      [
        'router_status',
        'device_state',
        'presence_history',
        'audit_history',
        'telemetry_timeseries',
        'dashboard_summary',
        'evidence_lookup',
        'device_traffic_usage'
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

  it('telemetry_timeseries validates range and defaults to 1d', () => {
    assert.deepEqual(telemetryTimeseriesTool.validate({}), { range: '1d' });
    assert.deepEqual(telemetryTimeseriesTool.validate({ range: '1w' }), { range: '1w' });
    assert.deepEqual(telemetryTimeseriesTool.validate({ range: '1m' }), { range: '1m' });
    assert.equal(telemetryTimeseriesTool.validate({ range: '7d' }), null);
    assert.equal(telemetryTimeseriesTool.validate({ range: 'all' }), null);
    assert.equal(telemetryTimeseriesTool.validate('1d'), null);
  });

  it('dashboard_summary accepts empty input only', () => {
    assert.ok(dashboardSummaryTool.validate({}));
    assert.ok(dashboardSummaryTool.validate(undefined));
    assert.ok(dashboardSummaryTool.validate(null));
    assert.equal(dashboardSummaryTool.validate({ range: '1d' }), null);
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

describe('alias seeding across session turns', () => {
  it('seedFromLegend restores keys so the same original keeps its alias', () => {
    const first = new AliasMap();
    // Turn 1 aliased a MAC, an IP, and a name.
    first.aliasFor('device', 'AA:BB:CC:DD:EE:10');
    first.aliasFor('device', 'ip:192.168.31.50');
    first.aliasFor('device', 'name:living-room-tv');
    const legend = first.legend();

    const second = new AliasMap();
    second.seedFromLegend(legend);
    // The same raw values map to the SAME aliases on the next turn.
    assert.equal(second.aliasFor('device', 'aa:bb:cc:dd:ee:10'), legend[0]!.alias);
    assert.equal(second.aliasFor('device', 'ip:192.168.31.50'), 'device_02');
    assert.equal(second.aliasFor('device', 'name:living-room-tv'), 'device_03');
    // New devices continue after the highest seeded number — no collision.
    assert.equal(second.aliasFor('device', 'AA:BB:CC:DD:EE:99'), 'device_04');
  });

  it('registerDevice reuses a legacy identifier alias', () => {
    const aliases = new AliasMap();
    aliases.seedFromLegend([{ alias: 'device_07', original: 'AA:BB:CC:DD:EE:10' }]);
    aliases.registerDevice({ id: 'synthetic-device-id', mac: 'aa:bb:cc:dd:ee:10', name: 'TV' });
    assert.equal(aliases.aliasFor('device', 'synthetic-device-id'), 'device_07');
    assert.equal(aliases.aliasFor('device', 'name:TV'), 'device_07');
  });

  it('does not merge two devices that share a name', () => {
    const aliases = new AliasMap();
    aliases.registerDevice({ id: 'device-a', mac: 'AA:BB:CC:DD:EE:20', name: 'iPhone' });
    aliases.registerDevice({ id: 'device-b', mac: 'AA:BB:CC:DD:EE:21', name: 'iPhone' });
    assert.notEqual(
      aliases.aliasFor('device', 'device-a'),
      aliases.aliasFor('device', 'device-b')
    );
  });

  it('seedFromLegend is idempotent and order-independent', () => {
    const first = new AliasMap();
    first.aliasFor('device', 'AA:BB:CC:DD:EE:10');
    first.aliasFor('device', 'AA:BB:CC:DD:EE:11');
    const legend = first.legend();

    const seeded = new AliasMap();
    seeded.seedFromLegend([...legend].reverse());
    seeded.seedFromLegend(legend); // double-seeding must not grow or renumber
    assert.equal(seeded.aliasFor('device', 'AA:BB:CC:DD:EE:11'), 'device_02');
    assert.equal(seeded.aliasFor('device', 'AA:BB:CC:DD:EE:12'), 'device_03');
  });

  it('seedFromLegend ignores malformed legend entries', () => {
    const seeded = new AliasMap();
    seeded.seedFromLegend([
      { alias: 'device_01', original: 'AA:BB:CC:DD:EE:10' },
      { alias: 'not-an-alias', original: 'x' },
      { alias: 'device_02', original: '' },
      { alias: 'device_03', original: 42 as unknown as string }
    ]);
    assert.equal(seeded.aliasFor('device', 'AA:BB:CC:DD:EE:10'), 'device_01');
    // Counter resumed past device_01; junk did not allocate numbers.
    assert.equal(seeded.aliasFor('device', 'AA:BB:CC:DD:EE:12'), 'device_02');
  });
});

describe('locale-aware system prompt', () => {
  it('directs Simplified Chinese for zh-CN and English for en', () => {
    const zh = systemPromptFor('zh-CN');
    const en = systemPromptFor('en');
    assert.ok(zh.includes('Simplified Chinese'), 'zh prompt carries the directive');
    assert.ok(en.includes('Always respond in English.'));
    // Shared read-only investigator core + data-views catalog in both.
    for (const prompt of [zh, en]) {
      assert.ok(prompt.includes('read-only network investigation assistant'));
      assert.ok(prompt.includes('Tools are strictly read-only'));
      assert.ok(prompt.includes('telemetry_timeseries'), 'catalog mentions the chart tool');
      assert.ok(prompt.includes('dashboard_summary'), 'catalog mentions the summary tool');
    }
  });
});

describe('historyFromInvestigations', () => {
  const completed = (question: string, finding: string) => ({
    status: 'completed',
    question,
    finding
  });

  it('keeps the last exchanges within bounds, oldest first', () => {
    const turns = [
      completed('q1', 'f1'),
      { status: 'failed', question: 'q2', finding: 'provider HTTP 500' },
      { status: 'running', question: 'q3', finding: null },
      completed('q4', 'f4')
    ];
    const history = historyFromInvestigations(turns);
    assert.equal(history.length, 2, 'failed/running skipped');
    assert.deepEqual(history, [
      { question: 'q1', finding: 'f1' },
      { question: 'q4', finding: 'f4' }
    ]);
  });

  it('keeps all exchanges without silently dropping history', () => {
    const turns = Array.from({ length: 8 }, (_, i) => completed(`q${i}`, `f${i}`));
    const history = historyFromInvestigations(turns);
    assert.equal(history.length, 8);
    assert.deepEqual(
      history.map((t) => t.question),
      ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
      'all history kept'
    );
  });
});

describe('conversation history reaches the provider', () => {
  it('runInvestigation replays history and the locale directive', async () => {
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(String(init?.body ?? ''));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'finding' } }] }),
        { status: 200 }
      );
    }) as typeof fetch;
    try {
      await runInvestigation(
        {
          mode: 'local',
          baseUrl: 'http://provider.test/v1',
          apiKey: null,
          model: 'test-model',
          privacy: LOCAL_PRIVACY
        },
        {
          pool: { query: async () => ({ rows: [] }) } as never,
          routerId: 'router-1'
        },
        'and the busiest device?',
        {
          locale: 'zh-CN',
          history: [
            { question: 'what is the traffic?', finding: ' WAN used 3 GB' }
          ]
        }
      );
      const firstRequest = JSON.parse(bodies[0]!) as {
        messages: Array<{ role: string; content: string }>;
      };
      const roles = firstRequest.messages.map((m) => m.role);
      assert.deepEqual(roles, ['system', 'user', 'assistant', 'user'], 'history replayed');
      assert.ok(firstRequest.messages[0]!.content.includes('Simplified Chinese'));
      assert.ok(
        firstRequest.messages.some((m) => m.role === 'assistant' && m.content === ' WAN used 3 GB'),
        'prior finding replayed as assistant turn'
      );
      assert.ok(
        firstRequest.messages.some((m) => m.role === 'user' && m.content === 'and the busiest device?'),
        'current question last'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('deterministic tool choice for traffic questions', () => {
  it('requires counter-delta lookup for period winner questions', () => {
    assert.equal(requiredToolFor('Who used the most download traffic in the past 24 hours?'), 'device_traffic_usage');
    assert.equal(requiredToolFor('過去24小時下載流量總和最多的是哪一個裝置？'), 'device_traffic_usage');
    assert.equal(requiredToolFor('可以知道 device_06 在哪個時段下載流量最高嗎？'), 'device_traffic_usage');
    assert.equal(requiredToolFor('What is the current download speed?'), null);
  });

  it('sends a required function choice on the first provider request', async () => {
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ choices: [{ message: calls++ === 0
        ? { role: 'assistant', content: '', tool_calls: [{ id: 'traffic', type: 'function', function: { name: 'device_traffic_usage', arguments: '{}' } }] }
        : { role: 'assistant', content: 'not enough samples' } }] }));
    }) as typeof fetch;
    try {
      await runInvestigation(
        { mode: 'local', baseUrl: 'http://provider.test/v1', apiKey: null, model: 'test', privacy: LOCAL_PRIVACY },
        { pool: { query: async () => ({ rows: [] }) } as never, routerId: 'router-1' },
        '過去24小時下載流量總和最多的是哪一個裝置？'
      );
      const body = JSON.parse(bodies[0]!) as { tool_choice?: { function?: { name?: string } } };
      assert.equal(body.tool_choice?.function?.name, 'device_traffic_usage');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns the peak interval evidence as separate, readable references', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: calls++ === 0
      ? { role: 'assistant', content: '', tool_calls: [{ id: 'traffic', type: 'function', function: { name: 'device_traffic_usage', arguments: '{}' } }] }
      : { role: 'assistant', content: 'device_01 peak observed' } }] }))) as typeof fetch;
    let queryCount = 0;
    const pool = { query: async (sql: string) => {
      queryCount++;
      if (sql.includes('FROM device WHERE router_id')) return { rows: [] };
      return { rows: [{
        identity: 'AA:BB:CC:DD:EE:01', downloadBytes: '10', sampleCount: 2,
        intervalCount: 1, resets: 0, missingCounters: 0, legacySamples: 0,
        firstSampleAt: new Date('2026-09-08T00:00:00Z'),
        lastSampleAt: new Date('2026-09-08T00:01:00Z'), maxGapSeconds: 60,
        firstEvidenceId: '101', lastEvidenceId: '102', observedDeviceCount: 1,
        peakStartAt: new Date('2026-09-08T00:00:00Z'),
        peakEndAt: new Date('2026-09-08T00:01:00Z'), peakDownloadBytes: '10',
        peakStartEvidenceId: '101', peakEndEvidenceId: '102'
      }] };
    } } as never;
    try {
      const result = await runInvestigation(
        { mode: 'external', baseUrl: 'http://provider.test/v1', apiKey: null, model: 'test', privacy: LOCAL_PRIVACY },
        { pool, routerId: 'router-1' },
        'device_01 在哪個時段下載流量最高嗎？'
      );
      assert.equal(queryCount, 2, 'inventory and fixed traffic query');
      assert.deepEqual(result.evidence.map((link) => link.evidenceId), ['101', '102']);
      assert.ok(result.finding.includes('- telemetry_snapshot #101'));
      assert.ok(result.finding.includes('- telemetry_snapshot #102'));
      assert.ok(result.finding.includes('peak interval end'));
    } finally { globalThis.fetch = originalFetch; }
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


describe('investigation privacy and transcript regressions', () => {
  const config = { mode: 'external' as const, baseUrl: 'http://provider.test/v1', apiKey: null,
    model: 'test', privacy: LOCAL_PRIVACY }; // Caller cannot bypass external policy.
  const ctx = { routerId: 'router-1', pool: { query: async () => ({ rows: [
    { id: 'd-1', name: 'SEN[1]TINEL-TV', mac: 'AA:BB:CC:DD:EE:FF', ip: 'fe80::1234' }
  ] }) } as never };

  it('scrubs names before the first request and replays full tool messages', async () => {
    const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init!.body!));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'device_01 observed' } }] }));
    }) as typeof fetch;
    try {
      const result = await runInvestigation(config, ctx,
        'Check SEN[1]TINEL-TV at fe80::1234 password=SENTINEL-SECRET', {
          history: [{ question: 'old', finding: 'answer', transcript: [
            { role: 'user', content: 'SEN[1]TINEL-TV' },
            { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'device_state', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'c1', content: '{"observed":123}' },
            { role: 'assistant', content: 'answer' }
          ] }]
        });
      const request = JSON.stringify(bodies);
      for (const secret of ['SEN[1]TINEL-TV', 'fe80::1234', 'SENTINEL-SECRET', 'AA:BB:CC:DD:EE:FF']) assert.ok(!request.includes(secret), secret);
      assert.ok(request.includes('observed'));
      assert.deepEqual(bodies[0]!.messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
      assert.deepEqual(result.transcript.map((m) => m.role), ['user', 'assistant']);
      assert.ok(result.aliasLegend.some((e) => e.original === 'name:SEN[1]TINEL-TV'));
    } finally { globalThis.fetch = original; }
  });

  it('only records evidence after a successful lookup and persists tool output', async () => {
    const original = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: ++n === 1
      ? { role: 'assistant', content: '', tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'evidence_lookup', arguments: '{"evidenceKind":"device","evidenceId":"missing"}' } },
        { id: 'c2', type: 'function', function: { name: 'evidence_lookup', arguments: '{"evidenceKind":"bogus","evidenceId":"invented"}' } }
      ] } : { role: 'assistant', content: 'No evidence available' } }] }))) as typeof fetch;
    try {
      const result = await runInvestigation(config, { routerId: 'r', pool: { query: async () => ({ rows: [] }) } as never }, 'check evidence');
      assert.deepEqual(result.evidence, []);
      assert.equal(result.transcript.filter((m) => m.role === 'tool').length, 2);
    } finally { globalThis.fetch = original; }
  });

  it('never propagates provider error bodies', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('password=SENTINEL-PROVIDER-SECRET', { status: 400 })) as typeof fetch;
    try { await assert.rejects(runInvestigation(config, ctx, 'check device'), { message: 'provider HTTP 400' }); }
    finally { globalThis.fetch = original; }
  });

  it('removes arbitrary telemetry fields before stringifying evidence', async () => {
    const toolCtx = { ...ctx, privacy: LOCAL_PRIVACY, aliases: new AliasMap(), pool: {
      query: async () => ({ rows: [{ id: '1', capturedAt: new Date(), payload: {
        cpuLoad: 5, password: 'SENTINEL-SECRET', hardwareInfo: { sn: 'SENTINEL-SERIAL' }, arbitrary: 'SENTINEL-NAME'
      } }] })
    } as never };
    const status = await routerStatusTool.execute(toolCtx, { limit: 1 });
    const evidence = await evidenceLookupTool.execute(toolCtx, { evidenceKind: 'telemetry_snapshot', evidenceId: '1' });
    assert.ok(!JSON.stringify([status, evidence]).includes('SENTINEL'));
    assert.ok(JSON.stringify(evidence).includes('cpuLoad'));
  });

  it('bounds traffic tool queries', () => {
    for (const hours of [0, 169, 1.5, '24', null]) assert.equal(deviceTrafficUsageTool.validate({ hours }), null);
    assert.equal(deviceTrafficUsageTool.validate({ limit: 51 }), null);
    assert.deepEqual(deviceTrafficUsageTool.validate({}), { hours: 24, limit: 10 });
  });
});
