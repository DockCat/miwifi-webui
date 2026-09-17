/**
 * Sidebar navigation component (Task 0014).
 * Supports full and collapsed (icon-only rail) modes with UniFi styling.
 */
import { type ReactNode, useContext } from 'react';
import { I18nContext } from '../i18n-context.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';

export type NavPage = 'dashboard' | 'devices' | 'network' | 'events' | 'investigations' | 'settings';

export interface SidebarProps {
  activePage: NavPage;
  isCollapsed: boolean;
  username: string;
  onNavigate: (page: NavPage) => void;
  onToggleCollapse: () => void;
  onLogout: () => void;
}

const SIDEBAR_COLLAPSED_KEY = 'miwifi-webui.sidebar-collapsed';

export function loadSidebarCollapsed(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function storeSidebarCollapsed(collapsed: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
    }
  } catch {
    // Storage access unavailable (e.g. private mode)
  }
}

function DashboardIcon() {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 14l3-3" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
      <line x1="12" y1="18" x2="12" y2="18.01" />
    </svg>
  );
}

function DevicesIcon() {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function NetworkIcon() {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function EventsIcon() {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

function InvestigationsIcon() {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function CollapseIcon({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {isCollapsed ? (
        <polyline points="9 18 15 12 9 6" />
      ) : (
        <polyline points="15 18 9 12 15 6" />
      )}
    </svg>
  );
}

interface NavItemProps {
  label: string;
  icon: ReactNode;
  active: boolean;
  isCollapsed: boolean;
  onClick: () => void;
}

function NavItem({ label, icon, active, isCollapsed, onClick }: NavItemProps) {
  return (
    <li>
      <button
        type="button"
        className={`nav-item ${active ? 'is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        title={label}
        aria-label={label}
        onClick={onClick}
      >
        <span className="nav-icon-wrapper">{icon}</span>
        {!isCollapsed && <span className="nav-label">{label}</span>}
      </button>
    </li>
  );
}

export function Sidebar({
  activePage,
  isCollapsed,
  username,
  onNavigate,
  onToggleCollapse,
  onLogout
}: SidebarProps) {
  const { t } = useContext(I18nContext);

  const collapseLabel = isCollapsed ? t('nav.expand') : t('nav.collapse');

  return (
    <nav
      className={`sidebar ${isCollapsed ? 'is-collapsed' : ''}`}
      aria-label="Main Navigation"
    >
      <div className="brand">
        {isCollapsed ? (
          <span className="brand-collapsed" title={t('app.title')}>
            MW
          </span>
        ) : (
          <>
            <span className="brand-name">{t('app.title')}</span>
            <span className="brand-sub">{t('app.tagline')}</span>
          </>
        )}
      </div>

      <ul className="nav-list">
        <NavItem
          label={t('nav.dashboard')}
          icon={<DashboardIcon />}
          active={activePage === 'dashboard'}
          isCollapsed={isCollapsed}
          onClick={() => onNavigate('dashboard')}
        />
        <NavItem
          label={t('nav.devices')}
          icon={<DevicesIcon />}
          active={activePage === 'devices'}
          isCollapsed={isCollapsed}
          onClick={() => onNavigate('devices')}
        />
        <NavItem
          label={t('nav.network')}
          icon={<NetworkIcon />}
          active={activePage === 'network'}
          isCollapsed={isCollapsed}
          onClick={() => onNavigate('network')}
        />
        <NavItem
          label={t('nav.events')}
          icon={<EventsIcon />}
          active={activePage === 'events'}
          isCollapsed={isCollapsed}
          onClick={() => onNavigate('events')}
        />
        <NavItem
          label={t('nav.investigations')}
          icon={<InvestigationsIcon />}
          active={activePage === 'investigations'}
          isCollapsed={isCollapsed}
          onClick={() => onNavigate('investigations')}
        />
        <NavItem
          label={t('nav.settings')}
          icon={<SettingsIcon />}
          active={activePage === 'settings'}
          isCollapsed={isCollapsed}
          onClick={() => onNavigate('settings')}
        />
      </ul>

      <div className="sidebar-footer">
        {!isCollapsed && (
          <>
            <span className="muted username-label">{username}</span>
            <LanguageSwitcher />
            <button
              type="button"
              className="link-button logout-button"
              onClick={onLogout}
            >
              <LogoutIcon />
              <span>{t('settings.logout')}</span>
            </button>
          </>
        )}
        {isCollapsed && (
          <div className="collapsed-footer-actions">
            <button
              type="button"
              className="icon-action-button"
              title={t('settings.logout')}
              aria-label={t('settings.logout')}
              onClick={onLogout}
            >
              <LogoutIcon />
            </button>
          </div>
        )}

        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={onToggleCollapse}
          aria-label={collapseLabel}
          title={collapseLabel}
          aria-expanded={!isCollapsed}
        >
          <CollapseIcon isCollapsed={isCollapsed} />
          {!isCollapsed && <span className="toggle-label">{collapseLabel}</span>}
        </button>
      </div>
    </nav>
  );
}
