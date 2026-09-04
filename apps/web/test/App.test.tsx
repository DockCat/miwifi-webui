/**
 * App render test (no DOM emulator dependency at bootstrap).
 *
 * Validates the initial App output — title, status text, and that the
 * component renders the backend-status section.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { App } from '../src/App.js';

describe('App', () => {
  it('renders the application shell', () => {
    const markup = renderToStaticMarkup(createElement(App));
    assert.ok(markup.includes('miwifi-webui'), 'renders the app title');
    assert.ok(markup.includes('Bootstrap'), 'renders bootstrap status badge');
    assert.ok(
      markup.includes('Backend API'),
      'renders the backend status row'
    );
  });

  it('contains no router endpoints or secrets', () => {
    const markup = renderToStaticMarkup(createElement(App));
    assert.ok(!markup.includes('stok'), 'no stok token in markup');
    assert.ok(!markup.includes('192.168.'), 'no hardcoded router IP in markup');
    assert.ok(!markup.includes('cgi-bin'), 'no MiWiFi endpoint paths in markup');
  });
});
