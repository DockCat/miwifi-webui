/**
 * Fixture transport: deterministic, scripted router responses for tests.
 *
 * A fixture is a scenario: a map of operation id -> response, plus login
 * behavior. This is how router integration stays testable without a real
 * router (AGENTS.md testing expectations).
 */
import {
  RouterTransportError,
  type RouterTransport,
  type RouterTransportRequest,
  type RouterTransportResponse
} from './transport.js';

export interface FixtureScenario {
  readonly name: string;
  /** init_info response body (null = offline). */
  readonly initInfo: unknown | null;
  /** login: { ok, token } — token null means auth failure. */
  readonly login: { ok: boolean; token: string | null };
  /** Per-operation responses after login. */
  readonly responses: Record<string, RouterTransportResponse>;
}

export class FixtureTransport implements RouterTransport {
  private loginAttempted = false;
  private loggedIn = false;

  constructor(public scenario: FixtureScenario) {}

  reset(): void {
    this.loginAttempted = false;
    this.loggedIn = false;
  }

  async request(req: RouterTransportRequest): Promise<RouterTransportResponse> {
    switch (req.operation) {
      case 'init_info':
        if (this.scenario.initInfo === null) {
          // Simulate an unreachable router, as HttpRouterTransport would.
          throw new RouterTransportError({ kind: 'offline' }, req.operation);
        }
        return { status: 200, body: this.scenario.initInfo };
      case 'login': {
        this.loginAttempted = true;
        if (!this.scenario.login.ok || this.scenario.login.token === null) {
          return { status: 401, body: { code: 401, msg: 'Incorrect password' } };
        }
        this.loggedIn = true;
        return { status: 200, body: { code: 0, token: this.scenario.login.token } };
      }
      default: {
        if (!this.loggedIn) {
          return { status: 401, body: { code: 401 } };
        }
        const scripted = this.scenario.responses[req.operation];
        if (scripted) return scripted;
        // Unsupported endpoint: 404-like MiWiFi error shape.
        return { status: 404, body: { code: 1, msg: 'not found' } };
      }
    }
  }

  get wasLoginAttempted(): boolean {
    return this.loginAttempted;
  }
}
