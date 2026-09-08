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
    const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new ApiError(body.error ?? `HTTP ${response.status}`, body.detail, response.status);
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
  readonly status?: number;
  readonly detail?: string;
  constructor(message: string, detail?: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.detail = detail;
    this.status = status;
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
      evidence: { id: string; kind: string; evidenceId: string; note?: string | null }[];
    }>(`/api/investigations/${id}`),

  listSessions: () =>
    request<{ sessions: SessionSummary[] }>('/api/investigations/sessions'),

  investigationSession: (id: string) =>
    request<{ session: SessionDetail; investigations: SessionTurn[] }>(
      `/api/investigations/sessions/${id}`
    ),

  closeSession: (id: string) =>
    request<{ sessionId: string; status: string }>(
      `/api/investigations/sessions/${id}/close`,
      { method: 'POST' }
    ),

  createInvestigation: (
    routerId: string,
    question: string,
    opts?: { sessionId?: string; locale?: 'en' | 'zh-CN' }
  ) =>
    request<{ investigationId: string; sessionId: string; rotatedFrom?: string | null; status: string; finding: string }>(
      '/api/investigations',
      {
        method: 'POST',
        body: JSON.stringify({
          routerId,
          question,
          sessionId: opts?.sessionId,
          locale: opts?.locale
        })
      }
    )
};

export interface InvestigationSummary {
  id: string;
  sessionId: string | null;
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
  transcript?: { role: string; content: string; tool_call_id?: string }[];
  aliasLegend: { alias: string; original: string }[];
}

/** Sidebar entry for an investigation session. */
export interface SessionSummary {
  id: string;
  title: string;
  status: 'open' | 'closed';
  turnCount: number;
  lastQuestion: string | null;
  createdAt: string;
  lastActivityAt: string;
  closedAt: string | null;
}

export interface SessionDetail {
  id: string;
  title: string;
  status: 'open' | 'closed';
  createdAt: string;
  lastActivityAt: string;
  closedAt: string | null;
}

/** One question/finding exchange inside a session. */
export interface SessionTurn {
  id: string;
  status: 'running' | 'completed' | 'failed';
  question: string;
  finding: string | null;
  provider: string;
  createdAt: string;
  completedAt: string | null;
}
