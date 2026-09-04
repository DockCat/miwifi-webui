/**
 * Status badge: online/offline state communicated with text + shape +
 * color (never color alone — plan section 35).
 */
import type { ReactNode } from 'react';

export interface StatusBadgeProps {
  readonly online: boolean | 'unknown';
  readonly label: string;
}

export function StatusBadge({ online, label }: StatusBadgeProps) {
  const state = online === true ? 'is-online' : online === false ? 'is-offline' : 'is-unknown';
  const glyph = online === true ? '●' : online === false ? '○' : '?';
  return (
    <span className={`badge status-badge ${state}`}>
      <span aria-hidden="true" className="badge-glyph">
        {glyph}
      </span>
      {label}
    </span>
  );
}

export function Card({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {title !== undefined && <h2 className="card-title">{title}</h2>}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}
