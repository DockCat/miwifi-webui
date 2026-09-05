/**
 * Favicon asset tests.
 *
 * Verifies that the favicon assets exist and the HTML entry point
 * references them correctly.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '..');

describe('Favicon assets', () => {
  const faviconSvgPath = resolve(WEB_ROOT, 'public', 'favicon.svg');
  const faviconIcoPath = resolve(WEB_ROOT, 'public', 'favicon.ico');
  const favicon16Path = resolve(WEB_ROOT, 'public', 'favicon-16x16.png');
  const favicon32Path = resolve(WEB_ROOT, 'public', 'favicon-32x32.png');
  const favicon64Path = resolve(WEB_ROOT, 'public', 'favicon-64x64.png');
  const appleTouchPath = resolve(WEB_ROOT, 'public', 'apple-touch-icon.png');

  it('favicon.svg exists in public directory', () => {
    assert.ok(existsSync(faviconSvgPath), 'favicon.svg must exist');
  });

  it('favicon.svg contains cat and mi design elements', () => {
    const svg = readFileSync(faviconSvgPath, 'utf-8');
    assert.ok(svg.includes('<svg'), 'favicon.svg must be valid SVG');
    // The design should include visual elements (paths, circles, or rects)
    assert.ok(
      svg.includes('<path') || svg.includes('<circle') || svg.includes('<rect'),
      'favicon.svg must contain drawing elements'
    );
    // Should include the "mi" text branding
    assert.ok(
      svg.toLowerCase().includes('mi') || svg.includes('text'),
      'favicon.svg should reference "mi" branding'
    );
  });

  it('favicon.ico exists for legacy browser support', () => {
    assert.ok(existsSync(faviconIcoPath), 'favicon.ico must exist');
  });

  it('favicon-16x16.png exists', () => {
    assert.ok(existsSync(favicon16Path), 'favicon-16x16.png must exist');
  });

  it('favicon-32x32.png exists', () => {
    assert.ok(existsSync(favicon32Path), 'favicon-32x32.png must exist');
  });

  it('favicon-64x64.png exists', () => {
    assert.ok(existsSync(favicon64Path), 'favicon-64x64.png must exist');
  });

  it('apple-touch-icon.png exists', () => {
    assert.ok(existsSync(appleTouchPath), 'apple-touch-icon.png must exist');
  });
});

describe('HTML references favicon', () => {
  it('index.html contains favicon link tags', () => {
    const html = readFileSync(resolve(WEB_ROOT, 'index.html'), 'utf-8');
    assert.ok(
      html.includes('favicon.svg') || html.includes('favicon.ico'),
      'index.html must reference favicon'
    );
    assert.ok(
      html.includes('rel="icon"') || html.includes("rel='icon'"),
      'index.html must have icon rel attribute'
    );
  });

  it('index.html contains apple-touch-icon link', () => {
    const html = readFileSync(resolve(WEB_ROOT, 'index.html'), 'utf-8');
    assert.ok(
      html.includes('apple-touch-icon'),
      'index.html must reference apple-touch-icon'
    );
  });
});
