/**
 * TDD Seam tests for Sidebar component (Task 0014).
 *
 * Seam 1: Sidebar render, icons, and tab naming (first tab must be Dashboard/儀表盤).
 * Seam 2: Collapsed mode state, accessibility (aria-expanded), and tooltips.
 * Seam 3: Persistence helpers with localStorage.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  Sidebar,
  loadSidebarCollapsed,
  storeSidebarCollapsed
} from '../src/components/Sidebar.js';
import { I18nContext } from '../src/i18n-context.js';
import { translate, type Locale, type MessageKey } from '../src/i18n.js';

function renderSidebarWithLocale(
  locale: Locale,
  props: {
    activePage: 'dashboard' | 'devices' | 'network' | 'events' | 'investigations' | 'settings';
    isCollapsed: boolean;
    username: string;
    onNavigate?: (page: string) => void;
    onToggleCollapse?: () => void;
    onLogout?: () => void;
  }
) {
  const t = (key: MessageKey) => translate(locale, key);
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: { locale, t, setLocale: () => {} } },
      createElement(Sidebar, {
        activePage: props.activePage,
        isCollapsed: props.isCollapsed,
        username: props.username,
        onNavigate: props.onNavigate ?? (() => {}),
        onToggleCollapse: props.onToggleCollapse ?? (() => {}),
        onLogout: props.onLogout ?? (() => {})
      })
    )
  );
}

describe('Sidebar Component (Task 0014)', () => {
  describe('Seam 1: Render and Tab Order', () => {
    it('renders the first tab as 仪表盘 (Dashboard), NOT 网络 (Network) in zh-CN', () => {
      const markup = renderSidebarWithLocale('zh-CN', {
        activePage: 'dashboard',
        isCollapsed: false,
        username: 'admin'
      });

      // Assert first tab contains 仪表盘
      const firstTabMatch = markup.match(/<li[^>]*>[\s\S]*?<\/li>/);
      assert.ok(firstTabMatch, 'Found first navigation item in markup');
      assert.ok(
        firstTabMatch[0].includes('仪表盘') || firstTabMatch[0].includes('儀表盤'),
        'First tab must be Dashboard/仪表盘'
      );
      assert.ok(
        !firstTabMatch[0].includes('网络') && !firstTabMatch[0].includes('網路'),
        'First tab must not be Network/网络'
      );
    });

    it('renders the first tab as Dashboard in en', () => {
      const markup = renderSidebarWithLocale('en', {
        activePage: 'dashboard',
        isCollapsed: false,
        username: 'admin'
      });

      const firstTabMatch = markup.match(/<li[^>]*>[\s\S]*?<\/li>/);
      assert.ok(firstTabMatch, 'Found first navigation item in markup');
      assert.ok(firstTabMatch[0].includes('Dashboard'), 'First tab must be Dashboard');
      assert.ok(!firstTabMatch[0].includes('Network'), 'First tab must not be Network');
    });

    it('renders SVG icons for all 6 navigation tabs', () => {
      const markup = renderSidebarWithLocale('en', {
        activePage: 'dashboard',
        isCollapsed: false,
        username: 'admin'
      });

      // Count SVG occurrences within the nav list
      const svgCount = (markup.match(/<svg/g) || []).length;
      assert.ok(svgCount >= 6, `Expected at least 6 SVGs for navigation items, found ${svgCount}`);
    });
  });

  describe('Seam 2: Collapsed Mode & Accessibility', () => {
    it('applies is-collapsed class and aria-expanded=false when collapsed', () => {
      const collapsedMarkup = renderSidebarWithLocale('en', {
        activePage: 'dashboard',
        isCollapsed: true,
        username: 'admin'
      });

      assert.ok(collapsedMarkup.includes('is-collapsed'), 'Sidebar has is-collapsed class');
      assert.ok(
        collapsedMarkup.includes('aria-expanded="false"'),
        'Collapse toggle reflects aria-expanded=false'
      );
    });

    it('provides tooltips via title attributes on navigation buttons', () => {
      const collapsedMarkup = renderSidebarWithLocale('zh-CN', {
        activePage: 'dashboard',
        isCollapsed: true,
        username: 'admin'
      });

      assert.ok(
        collapsedMarkup.includes('title="仪表盘"') || collapsedMarkup.includes('title="儀表盤"'),
        'Nav item has tooltip for Dashboard'
      );
      assert.ok(
        collapsedMarkup.includes('title="设备"') || collapsedMarkup.includes('title="設備"'),
        'Nav item has tooltip for Devices'
      );
    });

    it('renders a collapse toggle button with accessible label', () => {
      const markup = renderSidebarWithLocale('en', {
        activePage: 'dashboard',
        isCollapsed: false,
        username: 'admin'
      });

      assert.ok(
        markup.includes('sidebar-collapse-toggle'),
        'Markup contains sidebar-collapse-toggle button'
      );
      assert.ok(
        markup.includes('aria-expanded="true"'),
        'Collapse toggle reflects aria-expanded=true when expanded'
      );
    });
  });

  describe('Seam 3: Storage Persistence', () => {
    it('roundtrips collapsed state with localStorage safely', () => {
      const backing = new Map<string, string>();
      const shim = {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => void backing.set(key, value)
      };
      const original = (globalThis as { localStorage?: unknown }).localStorage;
      (globalThis as { localStorage?: unknown }).localStorage = shim;

      try {
        assert.equal(loadSidebarCollapsed(), false, 'Defaults to false when empty');
        storeSidebarCollapsed(true);
        assert.equal(loadSidebarCollapsed(), true, 'Restores true after store');
        storeSidebarCollapsed(false);
        assert.equal(loadSidebarCollapsed(), false, 'Restores false after store');
      } finally {
        (globalThis as { localStorage?: unknown }).localStorage = original;
      }
    });

    it('handles storage unavailability without throwing', () => {
      const original = (globalThis as { localStorage?: unknown }).localStorage;
      delete (globalThis as { localStorage?: unknown }).localStorage;

      try {
        assert.equal(loadSidebarCollapsed(), false, 'Safe fallback when localStorage is absent');
        // store should not throw
        storeSidebarCollapsed(true);
      } finally {
        (globalThis as { localStorage?: unknown }).localStorage = original;
      }
    });
  });
});
