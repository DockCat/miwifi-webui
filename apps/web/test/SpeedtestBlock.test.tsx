import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  SpeedtestBlock,
  formatMbps
} from '../src/components/dashboard/SpeedtestBlock.js';
import { I18nContext } from '../src/i18n-context.js';
import { translate, type Locale, type MessageKey } from '../src/i18n.js';

function renderSpeedtestWithLocale(
  locale: Locale,
  props: {
    routerId?: string;
    liveEvent?: { type: string; data: Record<string, unknown> } | null;
  } = {}
) {
  const t = (key: MessageKey) => translate(locale, key);
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: { locale, t, setLocale: () => {} } },
      createElement(SpeedtestBlock, {
        routerId: props.routerId,
        liveEvent: props.liveEvent
      })
    )
  );
}

describe('Seam 5: SpeedtestBlock Component', () => {
  it('formatMbps converts bytes per second to formatted Mbps correctly', () => {
    assert.equal(formatMbps(0), '0');
    assert.equal(formatMbps(-100), '0');
    assert.equal(formatMbps(10_000_000), '10.0');
    assert.equal(formatMbps(125_400_000), '125');
    assert.equal(formatMbps(55_200_000), '55.2');
  });

  it('renders card shell with title, provider dropdown, and run button in en', () => {
    const html = renderSpeedtestWithLocale('en');

    assert.ok(html.includes('Internet Speedtest'));
    assert.ok(html.includes('Run Speedtest'));
    assert.ok(html.includes('speedtest-provider-select'));
    assert.ok(html.includes('Cloudflare CDN'));
    assert.ok(html.includes('M-Lab (Google Speedtest)'));
    assert.ok(html.includes('Fast.com (Netflix)'));
    assert.ok(html.includes('Auto (Router / M-Lab / Cloudflare)'));
    assert.ok(html.includes('Latency'));
    assert.ok(html.includes('Download'));
    assert.ok(html.includes('Upload'));
  });

  it('renders translated text in zh-CN locale', () => {
    const html = renderSpeedtestWithLocale('zh-CN');

    assert.ok(html.includes('外網測速'));
    assert.ok(html.includes('立即測速'));
    assert.ok(html.includes('下載頻寬'));
    assert.ok(html.includes('上傳頻寬'));
    assert.ok(html.includes('延遲'));
    assert.ok(html.includes('自動 (路由器 / M-Lab / Cloudflare)'));
    assert.ok(html.includes('M-Lab (Google 測速同款)'));
  });

  it('renders completed speedtest event with badges and formatted rates', () => {
    const html = renderSpeedtestWithLocale('en', {
      liveEvent: {
        type: 'speedtest-complete',
        data: {
          id: 'test-1',
          downloadBps: 200_000_000,
          uploadBps: 50_000_000,
          pingMs: 14.5,
          jitterMs: 1.8,
          provider: 'auto',
          source: 'router',
          triggeredBy: 'manual',
          status: 'completed',
          createdAt: new Date('2026-09-18T00:00:00Z').toISOString()
        }
      }
    });

    assert.ok(html.includes('200')); // 200 Mbps
    assert.ok(html.includes('50.0')); // 50.0 Mbps
    assert.ok(html.includes('14.5 ms'));
    assert.ok(html.includes('1.8 ms'));
    assert.ok(html.includes('Router Native'));
  });

  it('renders backend provider badge when test source is backend', () => {
    const html = renderSpeedtestWithLocale('en', {
      liveEvent: {
        type: 'speedtest-complete',
        data: {
          id: 'test-2',
          downloadBps: 80_000_000,
          uploadBps: 20_000_000,
          pingMs: 25,
          jitterMs: 0,
          provider: 'cloudflare',
          source: 'backend',
          triggeredBy: 'scheduled',
          status: 'completed',
          createdAt: new Date().toISOString()
        }
      }
    });

    assert.ok(html.includes('Cloudflare · Server'));
  });

  it('renders mlab provider badge when provider is mlab', () => {
    const html = renderSpeedtestWithLocale('en', {
      liveEvent: {
        type: 'speedtest-complete',
        data: {
          id: 'test-3',
          downloadBps: 780_000_000,
          uploadBps: 820_000_000,
          pingMs: 4,
          jitterMs: 0,
          provider: 'mlab',
          source: 'backend',
          triggeredBy: 'manual',
          status: 'completed',
          createdAt: new Date().toISOString()
        }
      }
    });

    assert.ok(html.includes('M-Lab · Server'));
    assert.ok(html.includes('780'));
    assert.ok(html.includes('820'));
  });
});
