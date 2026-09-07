/**
 * Investigations view (Task 0007): chat-style interface. The conversation
 * pane shows the user's question followed by the assistant's finding for
 * each investigation, newest last; a composer at the bottom starts new
 * investigations. Alias legend and evidence stay attached to the finding
 * bubble they belong to.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type InvestigationDetail, type RouterSummary } from '../api.js';
import { EmptyState } from '../components.js';
import { useI18n } from '../i18n-context.js';
import type { MessageKey } from '../i18n.js';
import { formatTime } from './DashboardView.js';

interface InvestigationSummary {
  id: string;
  status: 'running' | 'completed' | 'failed';
  question: string;
  finding: string | null;
  provider: string;
  createdAt: string;
}

interface EvidenceLink {
  id: string;
  kind: string;
  evidenceId: string;
}

/** One question/finding exchange in the conversation. */
interface ChatTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly createdAt: string;
  readonly failed?: boolean;
  /** Assistant turns only: expanded detail loaded on demand. */
  readonly detail?: {
    aliasLegend: { alias: string; original: string }[];
    evidence: EvidenceLink[];
  };
}

/** Assemble chat turns from the investigation list; findings load on open. */
export function turnsFromInvestigations(
  investigations: readonly InvestigationSummary[],
  details: ReadonlyMap<string, InvestigationDetail & { evidence: EvidenceLink[] }>,
  t: (key: MessageKey) => string
): ChatTurn[] {
  // Oldest first so the conversation reads top-to-bottom.
  const ordered = [...investigations].reverse();
  const turns: ChatTurn[] = [];
  for (const investigation of ordered) {
    turns.push({
      id: `${investigation.id}-q`,
      role: 'user',
      text: investigation.question,
      createdAt: investigation.createdAt
    });
    const detail = details.get(investigation.id);
    const isFailed = investigation.status === 'failed';
    const failedText = investigation.finding
      ? `${t('investigations.finding_failed')} (${investigation.finding})`
      : t('investigations.finding_failed');

    turns.push({
      id: `${investigation.id}-a`,
      role: 'assistant',
      failed: isFailed,
      text:
        investigation.status === 'running'
          ? '…'
          : isFailed
            ? failedText
            : (detail?.finding ?? investigation.finding ?? ''),
      createdAt: investigation.createdAt,
      detail: detail
        ? {
            aliasLegend: detail.aliasLegend,
            evidence: detail.evidence
          }
        : undefined
    });
  }
  return turns;
}

export function InvestigationsView({ router }: { router: RouterSummary | null }) {
  const { t } = useI18n();
  const [investigations, setInvestigations] = useState<InvestigationSummary[] | null>(null);
  const [details, setDetails] = useState<
    Map<string, InvestigationDetail & { evidence: EvidenceLink[] }>
  >(new Map());
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = async (): Promise<void> => {
    try {
      const result = await api.listInvestigations();
      setInvestigations(result.investigations);
      // Prefetch detail for completed investigations so findings and
      // alias legends render inline without a click.
      for (const investigation of result.investigations) {
        if (investigation.status === 'completed') void openDetail(investigation.id);
      }
    } catch {
      setInvestigations([]);
    }
  };

  const openDetail = async (id: string): Promise<void> => {
    try {
      const result = await api.investigation(id);
      setDetails((current) => {
        const next = new Map(current);
        next.set(id, { ...result.investigation, evidence: result.evidence });
        return next;
      });
    } catch {
      // Detail stays unavailable; the list row still renders.
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const turns = investigations ? turnsFromInvestigations(investigations, details, t) : null;

  // Keep the newest exchange in view when history loads or a turn completes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [turns?.length, busy]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!router || busy) return;
    const trimmed = question.trim();
    if (trimmed.length < 3) return;
    setBusy(true);
    setError(null);
    // Optimistic user turn: append immediately, resolve below.
    const tempId = `pending-${Date.now()}`;
    setInvestigations((current) => {
      const base = current ?? [];
      return [
        ...base,
        {
          id: tempId,
          status: 'running' as const,
          question: trimmed,
          finding: null,
          provider: '',
          createdAt: new Date().toISOString()
        }
      ];
    });
    setQuestion('');
    try {
      await api.createInvestigation(router.id, trimmed);
      await load(); // replaces the optimistic turn with the real row
    } catch (caught) {
      setQuestion(trimmed); // let the user retry/edit
      try {
        await load();
      } catch {
        setInvestigations((current) => (current ?? []).filter((i) => i.id !== tempId));
      }
      if (caught instanceof ApiError && caught.message === 'ai_disabled') {
        setError(t('investigations.disabled_hint'));
      } else if (caught instanceof ApiError && caught.detail) {
        setError(`${t('investigations.finding_failed')} (${caught.detail})`);
      } else {
        setError(t('common.error'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-view">
      <div className="chat-scroll" role="log" aria-live="polite">
        {turns === null ? (
          <p className="muted">{t('common.loading')}</p>
        ) : turns.length === 0 ? (
          <EmptyState>{t('investigations.empty')}</EmptyState>
        ) : (
          turns.map((turn) =>
            turn.role === 'user' ? (
              <div className="chat-turn user" key={turn.id}>
                <div className="chat-bubble user">
                  <p className="chat-text">{turn.text}</p>
                </div>
                <time className="chat-time">{formatTime(turn.createdAt)}</time>
              </div>
            ) : (
              <div className="chat-turn assistant" key={turn.id}>
                <div className="chat-bubble assistant">
                  {turn.text === '…' ? (
                    <span className="chat-typing" aria-label={t('common.loading')}>
                      <i /><i /><i />
                    </span>
                  ) : turn.failed ? (
                    <p className="chat-text chat-failed">{turn.text}</p>
                  ) : (
                    <>
                      <p className="chat-text">{turn.text}</p>
                      {turn.detail && turn.detail.aliasLegend.length > 0 && (
                        <details className="alias-legend chat-collapsible">
                          <summary>{t('investigations.alias_legend')}</summary>
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>{t('investigations.alias')}</th>
                                <th>{t('investigations.original')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {turn.detail.aliasLegend.map((entry) => (
                                <tr key={entry.alias}>
                                  <td className="mono">{entry.alias}</td>
                                  <td className="mono">{entry.original}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      )}
                      {turn.detail && turn.detail.evidence.length > 0 && (
                        <details className="chat-collapsible">
                          <summary>
                            {t('investigations.evidence')} ({turn.detail.evidence.length})
                          </summary>
                          <ul className="chat-evidence">
                            {turn.detail.evidence.map((link) => (
                              <li key={link.id} className="mono">
                                {link.kind} #{link.evidenceId}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                </div>
                <time className="chat-time">{formatTime(turn.createdAt)}</time>
              </div>
            )
          )
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-composer" onSubmit={(event) => void submit(event)}>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="chat-composer-row">
          <input
            className="chat-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={router ? t('investigations.placeholder') : t('dashboard.no_routers')}
            disabled={!router || busy}
            aria-label={t('investigations.question_label')}
          />
          <button
            type="submit"
            className="chat-send"
            disabled={!router || busy || question.trim().length < 3}
          >
            {busy ? t('common.loading') : t('investigations.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
