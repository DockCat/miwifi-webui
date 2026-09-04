/**
 * Health endpoint response contract.
 *
 * Reports process-level availability only. Must never include environment
 * values, credentials, secrets, or internal stack traces.
 */
export interface HealthResponse {
  status: 'ok';
  service: 'miwifi-webui-api';
  time: string;
}

/**
 * Readiness endpoint response contract.
 *
 * Readiness additionally reflects critical dependencies such as the database.
 * Detail is limited to a dependency name -> boolean map so it stays safe to
 * expose to any caller.
 */
export interface ReadyResponse {
  status: 'ok' | 'unavailable';
  checks: {
    database: boolean;
  };
}
