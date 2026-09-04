import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseIPv4,
  isPermittedIPv4,
  isIPv6Literal,
  validateRouterTarget
} from '../src/index.js';

describe('parseIPv4', () => {
  it('parses valid dotted-quad literals', () => {
    assert.deepEqual(parseIPv4('192.168.31.1'), [192, 168, 31, 1]);
    assert.deepEqual(parseIPv4('10.0.0.138'), [10, 0, 0, 138]);
  });

  it('rejects non-literals', () => {
    assert.equal(parseIPv4('miwifi'), null);
    assert.equal(parseIPv4('192.168.31'), null);
    assert.equal(parseIPv4('192.168.31.1.5'), null);
    assert.equal(parseIPv4('256.1.1.1'), null);
    assert.equal(parseIPv4('192.168.31.999'), null);
    assert.equal(parseIPv4(''), null);
    assert.equal(parseIPv4('192.168.31.a'), null);
  });
});

describe('isPermittedIPv4', () => {
  it('permits RFC1918 private ranges', () => {
    assert.equal(isPermittedIPv4([10, 0, 0, 138]), true);
    assert.equal(isPermittedIPv4([172, 16, 0, 1]), true);
    assert.equal(isPermittedIPv4([172, 31, 255, 254]), true);
    assert.equal(isPermittedIPv4([192, 168, 31, 1]), true);
  });

  it('permits link-local and loopback', () => {
    assert.equal(isPermittedIPv4([169, 254, 1, 1]), true);
    assert.equal(isPermittedIPv4([127, 0, 0, 1]), true);
  });

  it('rejects public and out-of-policy addresses', () => {
    assert.equal(isPermittedIPv4([8, 8, 8, 8]), false);
    assert.equal(isPermittedIPv4([1, 1, 1, 1]), false);
    assert.equal(isPermittedIPv4([172, 32, 0, 1]), false);
    assert.equal(isPermittedIPv4([172, 15, 0, 1]), false);
    assert.equal(isPermittedIPv4([193, 168, 31, 1]), false);
    assert.equal(isPermittedIPv4([100, 64, 1, 1]), false);
  });
});

describe('isIPv6Literal', () => {
  it('permits loopback, link-local, and unique-local literals', () => {
    assert.equal(isIPv6Literal('::1'), true);
    assert.equal(isIPv6Literal('fe80::1'), true);
    assert.equal(isIPv6Literal('fe80::'), true);
    assert.equal(isIPv6Literal('fd00::1'), true);
    assert.equal(isIPv6Literal('fc00::1'), true);
  });

  it('rejects global and malformed literals', () => {
    assert.equal(isIPv6Literal('2001:db8::1'), false);
    assert.equal(isIPv6Literal('::ffff:192.168.31.1'), false);
    assert.equal(isIPv6Literal('::::'), false);
    assert.equal(isIPv6Literal('fe80:::1'), false);
    assert.equal(isIPv6Literal('no-colons'), false);
    assert.equal(isIPv6Literal('fe80::g1'), false);
    assert.equal(isIPv6Literal('fe80::1:'), false);
  });
});

describe('validateRouterTarget', () => {
  it('accepts private IPv4 router targets', () => {
    assert.deepEqual(validateRouterTarget('192.168.31.1'), { host: '192.168.31.1' });
    assert.deepEqual(validateRouterTarget(' 10.0.0.138 '), { host: '10.0.0.138' });
  });

  it('accepts conservative local hostname shapes', () => {
    assert.deepEqual(validateRouterTarget('miwifi'), { host: 'miwifi' });
    assert.deepEqual(validateRouterTarget('Router-Upper'), { host: 'router-upper' });
    assert.deepEqual(validateRouterTarget('miwifi.home'), { host: 'miwifi.home' });
    assert.deepEqual(validateRouterTarget('router.lan'), { host: 'router.lan' });
    assert.deepEqual(validateRouterTarget('node2.internal'), { host: 'node2.internal' });
    assert.deepEqual(validateRouterTarget('ap1.local'), { host: 'ap1.local' });
  });

  it('accepts permitted IPv6 literals', () => {
    assert.deepEqual(validateRouterTarget('::1'), { host: '::1' });
    assert.deepEqual(validateRouterTarget('fe80::1'), { host: 'fe80::1' });
  });

  it('rejects public IPv4 addresses', () => {
    assert.equal(validateRouterTarget('8.8.8.8'), null);
    assert.equal(validateRouterTarget('1.1.1.1'), null);
  });

  it('rejects URLs, schemes, ports, userinfo, and paths', () => {
    // The backend must never accept an arbitrary URL from the caller.
    assert.equal(validateRouterTarget('http://192.168.31.1'), null);
    assert.equal(validateRouterTarget('https://miwifi.home/cgi-bin/luci'), null);
    assert.equal(validateRouterTarget('192.168.31.1:80'), null);
    assert.equal(validateRouterTarget('user:pass@192.168.31.1'), null);
    assert.equal(validateRouterTarget('192.168.31.1/api'), null);
    assert.equal(validateRouterTarget('ftp://miwifi'), null);
  });

  it('rejects arbitrary public-looking domains', () => {
    assert.equal(validateRouterTarget('router.example.com'), null);
    assert.equal(validateRouterTarget('miwifi.duckdns.org'), null);
    assert.equal(validateRouterTarget('example.com'), null);
  });

  it('rejects empty and malformed input', () => {
    assert.equal(validateRouterTarget(''), null);
    assert.equal(validateRouterTarget('   '), null);
    assert.equal(validateRouterTarget('-leading-dash'), null);
    assert.equal(validateRouterTarget('under_score'), null);
  });
});
