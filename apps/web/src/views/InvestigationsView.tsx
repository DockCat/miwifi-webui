/**
 * Investigations view (Task 0007; sessions in Task 0011): two-pane layout.
 * A left rail lists past sessions (New session button + history); the
 * right pane is the chat. Turns inside a session share conversation
 * context with the AI; a closed session is read-only. Alias legend and
 * evidence stay attached to the finding bubble they belong to.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type InvestigationDetail,
  type RouterSummary,
  type SessionSummary,
  type SessionTurn
} from '../api.js';
import { EmptyState } from '../components.js';
import { useI18n } from '../i18n-context.js';
import type { MessageKey } from '../i18n.js';
import { formatTime } from './DashboardView.js';

interface EvidenceLink {
  id: string;
  kind: string;
  evidenceId: string;
  note?: string | null;
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
    transcript?: InvestigationDetail['transcript'];
  };
}

/** Assemble chat turns from session investigations; findings load on open. */
export function turnsFromInvestigations(
  investigations: readonly SessionTurn[],
  details: ReadonlyMap<string, InvestigationDetail & { evidence: EvidenceLink[] }>,
  t: (key: MessageKey) => string
): ChatTurn[] {
  // Session investigations arrive oldest-first already; keep that order so
  // the conversation reads top-to-bottom.
  const turns: ChatTurn[] = [];
  for (const investigation of investigations) {
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
            evidence: detail.evidence,
            transcript: detail.transcript
          }
        : undefined
    });
  }
  return turns;
}

/** Short relative time for the session rail (e.g. "5m", "2h", "3d"). */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function InvestigationsView({
  router,
  sessionId,
  onOpenSession
}: {
  router: RouterSummary | null;
  /** Session selected via the route (undefined = compose a new one). */
  sessionId?: string;
  onOpenSession: (id: string | undefined) => void;
}) {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [activeSession, setActiveSession] = useState<{
    id: string;
    status: 'open' | 'closed';
  } | null>(null);
  const [investigations, setInvestigations] = useState<SessionTurn[] | null>(null);
  const [details, setDetails] = useState<
    Map<string, InvestigationDetail & { evidence: EvidenceLink[] }>
  >(new Map());
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const selection = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      const result = await api.listSessions();
      setSessions(result.sessions);
    } catch {
      setSessions([]);
    }
  }, []);

  /** Load one session's turns (+ per-turn detail) into the chat pane. */
  const openSession = useCallback(
    async (id: string): Promise<void> => {
      const generation = ++selection.current;
      setLoadingSession(true);
      try {
        const result = await api.investigationSession(id);
        if (generation !== selection.current) return;
        setActiveSession({ id, status: result.session.status });
        setInvestigations(result.investigations);
        for (const turn of result.investigations) {
          if (turn.status === 'completed') void openTurnDetail(turn.id);
        }
      } catch {
        if (generation !== selection.current) return;
        setError('Unable to load session');
      } finally {
        if (generation === selection.current) setLoadingSession(false);
      }
    },
    []
  );

  const openTurnDetail = async (id: string): Promise<void> => {
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
    void loadSessions();
  }, [loadSessions]);

  // Route-driven session selection: an id opens that session, no id means
  // a fresh conversation (lazy session creation on first send).
  useEffect(() => {
    setActiveSession(null);
    setInvestigations(null);
    if (sessionId) {
      void openSession(sessionId);
    } else {
      selection.current++;
      setLoadingSession(false);
      setActiveSession(null);
      setInvestigations(null);
    }
  }, [sessionId, openSession]);

  const turns = investigations ? turnsFromInvestigations(investigations, details, t) : null;

  // Keep the newest exchange in view when history loads or a turn completes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [turns?.length, busy]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!router || busy || loadingSession || (sessionId && !activeSession) || activeSession?.status === 'closed') return;
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
          createdAt: new Date().toISOString(),
          completedAt: null
        }
      ];
    });
    setQuestion('');
    try {
      const result = await api.createInvestigation(router.id, trimmed, {
        sessionId: activeSession?.id,
        locale
      });
      // New sessions materialize server-side: reflect the id in the route
      // so a refresh reopens the same conversation.
      if (result.rotatedFrom) setNotice(t('investigations.session_rotated'));
      if (result.sessionId !== activeSession?.id) {
        onOpenSession(result.sessionId);
      }
      await Promise.all([
        openSession(result.sessionId),
        loadSessions()
      ]);
    } catch (caught) {
      setInvestigations((current) => (current ?? []).filter((i) => i.id !== tempId));
      setQuestion(trimmed); // let the user retry/edit
      try {
        await Promise.all([
          activeSession ? openSession(activeSession.id) : Promise.resolve(),
          loadSessions()
        ]);
      } catch {
        setInvestigations((current) =>
          (current ?? []).filter((i) => i.id !== tempId)
        );
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

  const startNewSession = (): void => {
    setError(null);
    setNotice(null);
    setQuestion('');
    onOpenSession(undefined);
  };

  const closeSession = async (): Promise<void> => {
    if (!activeSession || activeSession.status !== 'open') return;
    try {
      await api.closeSession(activeSession.id);
      setActiveSession({ id: activeSession.id, status: 'closed' });
      await Promise.all([openSession(activeSession.id), loadSessions()]);
    } catch {
      setError(t('common.error'));
    }
  };

  const composerDisabled =
    !router || busy || loadingSession || Boolean(sessionId && !activeSession) || activeSession?.status === 'closed';

  return (
    <div className="sessions-view">
      <aside className="sessions-rail">
        <button
          className="chat-new-session"
          onClick={startNewSession}
          disabled={busy || !router}
        >
          + {t('investigations.new_session')}
        </button>
        {sessions === null ? (
          <p className="muted">{t('common.loading')}</p>
        ) : sessions.length === 0 ? (
          <p className="muted rail-empty">{t('investigations.empty_sessions')}</p>
        ) : (
          <ul className="session-list" role="listbox" aria-label={t('investigations.sessions')}>
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  className={`session-item ${session.id === activeSession?.id ? 'is-active' : ''}`}
                  role="option"
                  aria-selected={session.id === activeSession?.id}
                  disabled={busy}
                  onClick={() => { setError(null); setNotice(null); onOpenSession(session.id); }}
                  title={session.title}
                >
                  <span className={`session-status ${session.status}`} title={session.status} />
                  <span className="session-item-body">
                    <span className="session-title">{session.title}</span>
                    <span className="session-meta muted">
                      {relativeTime(session.lastActivityAt)} · {session.turnCount}{' '}
                      {t('investigations.turns')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="chat-view">
        <div className="chat-scroll" role="log" aria-live="polite">
          {notice && <p role="status">{notice}</p>}
          {activeSession?.status === 'closed' && (
            <p className="session-closed-banner" role="status">
              {t('investigations.session_closed')}{' '}
              <button className="link-button" onClick={startNewSession}>
                {t('investigations.new_session')}
              </button>
            </p>
          )}
          {turns === null ? (
            activeSession ? (
              <p className="muted">{t('common.loading')}</p>
            ) : (
              <EmptyState>{t('investigations.empty')}</EmptyState>
            )
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
                                  <tr key={`${entry.alias}:${entry.original}`}>
                                    <td className="mono">{entry.alias}</td>
                                    <td className="mono">{entry.original}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        )}
                        {turn.detail?.transcript?.some((message) => message.role === 'tool') && (
                          <details className="chat-collapsible">
                            <summary>{t('investigations.tool_results')}</summary>
                            {turn.detail.transcript.filter((message) => message.role === 'tool').map((message, index) => (
                              <pre className="chat-text" key={index}>{message.content}</pre>
                            ))}
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
                                  {link.kind} #{link.evidenceId}{link.note ? ` - ${link.note}` : ''}
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
            {activeSession?.status === 'open' && (
              <button
                type="button"
                className="chat-end-session"
                onClick={() => void closeSession()}
                disabled={busy}
                title={t('investigations.close_session')}
              >
                {t('investigations.close_session')}
              </button>
            )}
            <input
              className="chat-input"
              maxLength={2000}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={
                activeSession?.status === 'closed'
                  ? t('investigations.session_closed')
                  : router
                    ? t('investigations.placeholder')
                    : t('dashboard.no_routers')
              }
              disabled={composerDisabled}
              aria-label={t('investigations.question_label')}
            />
            <button
              type="submit"
              className="chat-send"
              disabled={composerDisabled || question.trim().length < 3}
            >
              {busy ? t('common.loading') : t('investigations.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
