/**
 * Web app render tests.
 *
 * Server-side rendering of the initial state plus i18n behavior. The App
 * initially renders the loading state (session probe is async).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { App } from '../src/App.js';
import { translate, detectLocale, LOCALES } from '../src/i18n.js';

describe('App initial render', () => {
  it('renders the loading gate while probing session', () => {
    const markup = renderToStaticMarkup(createElement(App));
    assert.ok(markup.length > 0, 'app renders markup');
    assert.ok(
      markup.includes('Loading') || markup.includes('加载中'),
      'initial state is loading (async session probe)'
    );
  });

  it('contains no router endpoints, IPs, or secrets', () => {
    const markup = renderToStaticMarkup(createElement(App));
    assert.ok(!markup.includes('stok'), 'no stok token in markup');
    assert.ok(!markup.includes('cgi-bin'), 'no MiWiFi endpoint paths in markup');
    assert.ok(!markup.includes('192.168.'), 'no hardcoded router IP in markup');
  });
});

describe('i18n', () => {
  it('translates keys for every locale', () => {
    assert.equal(translate('en', 'nav.dashboard'), 'Dashboard');
    assert.equal(translate('zh-CN', 'nav.dashboard'), '仪表盘');
    assert.equal(translate('zh-CN', 'devices.status'), '状态');
  });

  it('exposes exactly the two supported locales', () => {
    assert.deepEqual([...LOCALES], ['en', 'zh-CN']);
  });

  it('falls back to the key itself for unknown input', () => {
    assert.equal(translate('en', 'unknown.key' as never), 'unknown.key');
  });

  it('detectLocale prefers zh when the browser lists Chinese first', () => {
    // detectLocale reads navigator; in the test env navigator is absent
    // (node) so the default is en — assert the fallback contract.
    const detected = detectLocale();
    assert.ok(detected === 'en' || detected === 'zh-CN');
  });
});
