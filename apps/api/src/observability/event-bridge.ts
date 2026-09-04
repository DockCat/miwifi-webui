/**
 * EventBridge: in-process pub/sub feeding the SSE endpoint.
 *
 * Keeps a bounded ring of recent events so SSE reconnects with
 * Last-Event-ID can replay what a client missed (plan: SSE where
 * suitable). Events are safe for browser consumption — they never carry
 * stok, credentials, or raw request material.
 */

export interface BridgeEvent {
  readonly id: number;
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly at: string;
}

type Listener = (event: BridgeEvent) => void;

const RING_SIZE = 200;

export class EventBridge {
  private nextId = 1;
  private readonly ring: BridgeEvent[] = [];
  private readonly listeners = new Set<Listener>();

  publish(type: string, data: Record<string, unknown>): BridgeEvent {
    const event: BridgeEvent = {
      id: this.nextId++,
      type,
      data,
      at: new Date().toISOString()
    };
    this.ring.push(event);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken listener must not break the publisher.
      }
    }
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Events with id > after, in order (for Last-Event-ID replay). */
  eventsAfter(after: number): readonly BridgeEvent[] {
    return this.ring.filter((event) => event.id > after);
  }

  get lastId(): number {
    return this.nextId - 1;
  }
}
