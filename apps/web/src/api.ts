/**
 * API client + session state for the web app.
 * All calls go to our backend only (ADR 0001); the browser never talks to
 * the router directly.
 */

export interface RouterSummary {
  id: string;
  host: string;
  model: string | null;
  hardware: string | null;
  romVersion: string | null;
  compatibility: 'SUPPORTED' | 'PARTIAL' | 'UNKNOWN' | 'INCOMPATIBLE';
  capabilities: string[];
  lastProbedAt: string | null;
}

export interface DeviceRow {
  id: string;
  mac: string | null;
  name: string | null;
  ip: string | null;
  online: boolean;
  internetAccess: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  downspeed?: number;
  upspeed?: number;
  downloadTotal?: number;
  uploadTotal?: number;
  connectionType?: 'wired' | 'wifi_2g' | 'wifi_5g' | 'guest' | 'unknown';
}

export interface TimeseriesPoint {
  timestamp: string;
  downspeed: number;
  upspeed: number;
  deviceCount: number;
  cpuLoad: number;
  memUsed: number;
  temperature?: number;
}

export interface PresenceEvent {
  id: number;
  deviceId: string;
  routerId: string;
  kind: 'FIRST_SEEN' | 'ONLINE' | 'OFFLINE';
  occurredAt: string;
}

export interface TelemetrySnapshot {
  id: number;
  routerId: string;
  capturedAt: string;
  payload: Record<string, unknown>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {})
    },
    credentials: 'same-origin'
  });
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthenticated');
    this.name = 'UnauthorizedError';
  }
}

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = {
  login: (username: string, password: string) =>
    request<{ status: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    }),

  bootstrap: (username: string, password: string) =>
    request<{ status: string }>('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    }),

  logout: () => request<{ status: string }>('/api/auth/logout', { method: 'POST' }),

  session: () => request<{ username: string }>('/api/auth/session'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    }),

  routers: () => request<{ routers: RouterSummary[] }>('/api/routers'),

  onboardRouter: (host: string, username: string, password: string) =>
    request<{ router: RouterSummary }>('/api/routers/onboard', {
      method: 'POST',
      body: JSON.stringify({ host, username, password })
    }),

  routerStatus: (routerId: string) =>
    request<{ routerId: string; status: Record<string, unknown> }>(
      `/api/routers/${routerId}/status`
    ),

  devices: (routerId: string) =>
    request<{ devices: DeviceRow[] }>(`/api/routers/${routerId}/devices`),

  presence: (routerId: string, deviceId?: string) =>
    request<{ events: PresenceEvent[] }>(
      `/api/routers/${routerId}/presence${deviceId ? `?deviceId=${deviceId}` : ''}`
    ),

  telemetry: (routerId: string) =>
    request<{ snapshots: TelemetrySnapshot[] }>(`/api/routers/${routerId}/telemetry`),

  telemetryTimeseries: (routerId: string, range: '1d' | '1w' | '1m' = '1d') =>
    request<{ points: TimeseriesPoint[] }>(
      `/api/routers/${routerId}/telemetry/timeseries?range=${range}`
    ),

  blockDevice: (routerId: string, deviceId: string) =>
    request<{ status: string; state: string }>(
      `/api/routers/${routerId}/devices/${deviceId}/block`,
      { method: 'POST' }
    ),

  unblockDevice: (routerId: string, deviceId: string) =>
    request<{ status: string; state: string }>(
      `/api/routers/${routerId}/devices/${deviceId}/unblock`,
      { method: 'POST' }
    ),

  listInvestigations: () =>
    request<{ investigations: InvestigationSummary[] }>('/api/investigations'),

  investigation: (id: string) =>
    request<{
      investigation: InvestigationDetail;
      evidence: { id: string; kind: string; evidenceId: string }[];
    }>(`/api/investigations/${id}`),

  createInvestigation: (routerId: string, question: string) =>
    request<{ investigationId: string; status: string; finding: string }>(
      '/api/investigations',
      { method: 'POST', body: JSON.stringify({ routerId, question }) }
    )
};

export interface InvestigationSummary {
  id: string;
  status: 'running' | 'completed' | 'failed';
  question: string;
  finding: string | null;
  provider: string;
  createdAt: string;
  completedAt: string | null;
}

export interface InvestigationDetail extends InvestigationSummary {
  model: string | null;
  /** alias -> original mapping used when the provider saw pseudonymized data. */
  aliasLegend: { alias: string; original: string }[];
}
