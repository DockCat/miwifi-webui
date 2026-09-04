/**
 * SSE hook: subscribes to /api/events with automatic reconnect and
 * Last-Event-ID resume (server ring replays missed events).
 */
import { useEffect, useRef } from 'react';

export interface SseEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  at: string;
}

export function useLiveEvents(
  enabled: boolean,
  onEvent: (event: SseEvent) => void
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = (): void => {
      source = new EventSource('/api/events');
      source.onopen = () => {
        // Connected; the server replays missed ids via Last-Event-ID.
      };
      const forward = (type: string) => (raw: MessageEvent) => {
        try {
          const data = JSON.parse(String(raw.data)) as Record<string, unknown>;
          handlerRef.current({
            id: Number(raw.lastEventId),
            type,
            data,
            at: typeof data['at'] === 'string' ? data['at'] : new Date().toISOString()
          });
        } catch {
          // Malformed frame: ignore rather than tear down the stream.
        }
      };
      for (const type of ['router-status', 'presence', 'inventory']) {
        source.addEventListener(type, forward(type));
      }
      source.onerror = () => {
        source?.close();
        source = null;
        if (!closed) {
          // Backoff reconnect.
          retryTimer = setTimeout(connect, 3_000);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [enabled]);
}
