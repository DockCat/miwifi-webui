/**
 * Minimal hash router — no dependency; the v1 UI has five routes.
 */
import { useEffect, useState } from 'react';

export type Route =
  | { page: 'dashboard' }
  | { page: 'devices'; deviceId?: string }
  | { page: 'network' }
  | { page: 'events' }
  | { page: 'investigations'; sessionId?: string }
  | { page: 'settings' };

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const [head, second] = clean.split('/');
  switch (head) {
    case 'devices':
      return { page: 'devices', deviceId: second || undefined };
    case 'network':
      return { page: 'network' };
    case 'events':
      return { page: 'events' };
    case 'investigations':
      return { page: 'investigations', sessionId: second || undefined };
    case 'settings':
      return { page: 'settings' };
    default:
      return { page: 'dashboard' };
  }
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(currentHash()));

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (next: Route): void => {
    if (typeof window === 'undefined') {
      setRoute(next);
      return;
    }
    let hash = '#/';
    switch (next.page) {
      case 'devices':
        hash = next.deviceId ? `#/devices/${next.deviceId}` : '#/devices';
        break;
      case 'network':
        hash = '#/network';
        break;
      case 'events':
        hash = '#/events';
        break;
      case 'investigations':
        hash = next.sessionId ? `#/investigations/${next.sessionId}` : '#/investigations';
        break;
      case 'settings':
        hash = '#/settings';
        break;
      case 'dashboard':
        hash = '#/';
        break;
    }
    if (window.location.hash === hash) {
      setRoute(next); // Force re-render for same-hash navigations.
    } else {
      window.location.hash = hash;
    }
  };

  return [route, navigate];
}
