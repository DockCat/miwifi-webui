/**
 * Investigations chat view tests: turn assembly from investigation rows
 * and rendered markup for question/finding exchanges.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { InvestigationsView, turnsFromInvestigations } from '../src/views/InvestigationsView.js';
import { translate } from '../src/i18n.js';
import type { RouterSummary } from '../src/api.js';

const ROUTER: RouterSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  host: '192.168.31.1',
  model: 'AX6000',
  hardware: 'RB06',
  romVersion: '1.0.60',
  compatibility: 'SUPPORTED',
  capabilities: ['router-info', 'device-inventory'],
  lastProbedAt: '2026-09-05T00:00:00Z'
};

describe('i18n for the chat view', () => {
  it('defines the failed-finding message in both locales', () => {
    assert.ok(translate('en', 'investigations.finding_failed').length > 0);
    assert.ok(translate('zh-CN', 'investigations.finding_failed').length > 0);
    assert.notEqual(
      translate('en', 'investigations.finding_failed'),
      'investigations.finding_failed'
    );
  });
});

describe('InvestigationsView chat layout', () => {
  // The view fetches on mount; under SSR the effect never runs, so the
  // initial render shows the loading state and the composer chrome.
  it('renders the chat pane with composer even while history loads', () => {
    const markup = renderToStaticMarkup(
      createElement(InvestigationsView, { router: ROUTER })
    );
    assert.ok(markup.includes('chat-view'), 'chat container');
    assert.ok(markup.includes('chat-scroll'), 'scrolling history pane');
    assert.ok(markup.includes('chat-composer'), 'bottom composer');
    assert.ok(
      markup.includes('chat-input') && markup.includes('chat-send'),
      'input + send button'
    );
    assert.ok(markup.includes(translate('en', 'investigations.placeholder')));
  });

  it('disables the composer when no router is onboarded', () => {
    const markup = renderToStaticMarkup(
      createElement(InvestigationsView, { router: null })
    );
    assert.ok(markup.includes('disabled'), 'input disabled without router');
    assert.ok(
      markup.includes(translate('en', 'dashboard.no_routers')),
      'no-router hint in placeholder'
    );
  });

  it('renders no router endpoints or secrets in markup', () => {
    const markup = renderToStaticMarkup(
      createElement(InvestigationsView, { router: ROUTER })
    );
    assert.ok(!markup.includes('stok'), 'no stok token');
    assert.ok(!markup.includes('cgi-bin'), 'no MiWiFi endpoint paths');
  });
});

describe('turnsFromInvestigations failure formatting', () => {
  it('formats failed turns with specific provider error finding', () => {
    const t = (key: string) => translate('zh-CN', key as never);
    const turns = turnsFromInvestigations(
      [
        {
          id: 'inv-1',
          status: 'failed',
          question: '測試問題',
          finding: 'credit insufficient balance: balance=0 required=708',
          provider: 'external',
          createdAt: '2026-09-06T12:00:00Z'
        }
      ],
      new Map(),
      t as never
    );

    assert.equal(turns.length, 2);
    assert.equal(turns[0]!.role, 'user');
    assert.equal(turns[1]!.role, 'assistant');
    assert.equal(turns[1]!.failed, true);
    assert.ok(turns[1]!.text.includes('credit insufficient balance: balance=0 required=708'));
    assert.ok(turns[1]!.text.includes(translate('zh-CN', 'investigations.finding_failed')));
  });

  it('formats failed turns without finding gracefully', () => {
    const t = (key: string) => translate('en', key as never);
    const turns = turnsFromInvestigations(
      [
        {
          id: 'inv-2',
          status: 'failed',
          question: 'test question',
          finding: null,
          provider: 'external',
          createdAt: '2026-09-06T12:00:00Z'
        }
      ],
      new Map(),
      t as never
    );

    assert.equal(turns.length, 2);
    assert.equal(turns[1]!.failed, true);
    assert.equal(turns[1]!.text, translate('en', 'investigations.finding_failed'));
  });
});
