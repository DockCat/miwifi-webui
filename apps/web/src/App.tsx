import { useEffect, useState } from 'react';
import type { HealthResponse } from '@miwifi-webui/contracts';

type BackendState =
  | { kind: 'unknown' }
  | { kind: 'checking' }
  | { kind: 'ok'; time: string }
  | { kind: 'down' };

const initialState: BackendState = { kind: 'unknown' };

export function App() {
  const [backend, setBackend] = useState<BackendState>(initialState);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      setBackend({ kind: 'checking' });
      try {
        const response = await fetch('/api/health');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as HealthResponse;
        if (!cancelled) setBackend({ kind: 'ok', time: body.time });
      } catch {
        if (!cancelled) setBackend({ kind: 'down' });
      }
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <h1>miwifi-webui</h1>
      <p>Self-hosted administration, observability, and investigation for Xiaomi routers.</p>
      <span className="badge">Bootstrap · early development</span>

      <div className="status-row">
        {backend.kind === 'ok' && (
          <p className="ok">Backend API: online ({backend.time})</p>
        )}
        {backend.kind === 'down' && <p className="down">Backend API: offline</p>}
        {backend.kind === 'checking' && <p>Backend API: checking…</p>}
        {backend.kind === 'unknown' && <p>Backend API: not checked</p>}
      </div>
    </div>
  );
}
