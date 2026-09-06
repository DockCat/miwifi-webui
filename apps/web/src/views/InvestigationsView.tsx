/**
 * Investigations view (Task 0007): start a session, list sessions, show
 * findings with inspectable evidence ids.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type InvestigationDetail, type RouterSummary } from '../api.js';
import { Card, EmptyState } from '../components.js';
import { useI18n } from '../i18n-context.js';

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

export function InvestigationsView({ router }: { router: RouterSummary | null }) {
  const { t } = useI18n();
  const [investigations, setInvestigations] = useState<InvestigationSummary[] | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    investigation: InvestigationDetail;
    evidence: EvidenceLink[];
  } | null>(null);

  const load = async (): Promise<void> => {
    try {
      const result = await api.listInvestigations();
      setInvestigations(result.investigations);
    } catch {
      setInvestigations([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openDetail = async (id: string): Promise<void> => {
    try {
      const detail = await api.investigation(id);
      setSelected({
        investigation: detail.investigation,
        evidence: detail.evidence
      });
    } catch {
      setSelected(null);
    }
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!router) return;
    setBusy(true);
    setError(null);
    try {
      await api.createInvestigation(router.id, question.trim());
      setQuestion('');
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.message === 'ai_disabled') {
        setError('AI is disabled. Configure a provider (see .env.example).');
      } else {
        setError(t('common.error'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view-grid">
      <Card title={t('investigations.title')}>
        <form className="stack" onSubmit={(event) => void submit(event)}>
          <label>
            <span>
              {router ? t('investigations.question_label') : t('dashboard.no_routers')}
            </span>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t('investigations.placeholder')}
              disabled={!router || busy}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" disabled={!router || busy || question.trim().length < 3}>
            {busy ? t('common.loading') : t('investigations.submit')}
          </button>
        </form>

        {investigations === null ? (
          <p>{t('common.loading')}</p>
        ) : investigations.length === 0 ? (
          <EmptyState>{t('investigations.empty')}</EmptyState>
        ) : (
          <ul className="event-list">
            {investigations.map((investigation) => (
              <li key={investigation.id}>
                <button className="link-button" onClick={() => void openDetail(investigation.id)}>
                  {investigation.question.slice(0, 60)}
                </button>
                <span className={`badge status-badge ${investigation.status === 'completed' ? 'is-online' : investigation.status === 'failed' ? 'is-offline' : 'is-unknown'}`}>
                  {investigation.status}
                </span>
                <time>{new Date(investigation.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected && (
        <Card title={t('investigations.finding')}>
          <p className="finding-text">{selected.investigation.finding ?? '—'}</p>
          {selected.investigation.aliasLegend.length > 0 && (
            <div className="alias-legend">
              <h3>{t('investigations.alias_legend')}</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('investigations.alias')}</th>
                    <th>{t('investigations.original')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.investigation.aliasLegend.map((entry) => (
                    <tr key={entry.alias}>
                      <td className="mono">{entry.alias}</td>
                      <td className="mono">{entry.original}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>{t('investigations.evidence')}</h3>
          {selected.evidence.length === 0 ? (
            <EmptyState>{t('investigations.no_evidence')}</EmptyState>
          ) : (
            <ul className="event-list">
              {selected.evidence.map((link) => (
                <li key={link.id}>
                  <span className="mono">{link.kind} #{link.evidenceId}</span>
                </li>
              ))}
            </ul>
          )}
          <button className="link-button" onClick={() => setSelected(null)}>Close</button>
        </Card>
      )}
    </div>
  );
}
