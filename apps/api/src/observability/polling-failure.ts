/**
 * Router polling errors exposed to the UI/logs must be classified only from
 * bounded, non-secret metadata. Never include the URL (stok), raw response,
 * credentials, exception.message, or stack in diagnostic events.
 */
import { RouterTransportError } from '@miwifi-webui/router-core';

export type RouterPollingFailureReason =
  | 'ROUTER_OFFLINE'
  | 'TIMEOUT'
  | 'AUTH_FAILED'
  | 'API_ERROR';

export function classifyRouterPollingFailure(error: unknown): RouterPollingFailureReason {
  if (!(error instanceof RouterTransportError)) return 'API_ERROR';
  switch (error.failure.kind) {
    case 'offline': return 'ROUTER_OFFLINE';
    case 'timeout': return 'TIMEOUT';
    case 'authentication':
    case 'session-expired': return 'AUTH_FAILED';
    case 'http-status':
      if (error.failure.status === 401 || error.failure.status === 403) return 'AUTH_FAILED';
      if (error.failure.status === 408 || error.failure.status === 504) return 'TIMEOUT';
      return 'API_ERROR';
    case 'malformed':
    case 'aborted':
    default: return 'API_ERROR';
  }
}
