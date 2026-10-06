'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api-client';

interface QueueEntry {
  id: string;
  patientId: string;
  tokenNumber: number;
  status: string;
  joinedAt: string;
  calledAt: string | null;
}

interface QueueDetail {
  id: string;
  queueDate: string;
  entries: QueueEntry[];
}

/** Reliable polling, not WebSockets, for Phase 3 (master doc §75 — queue state correctness matters more than real-time presentation). */
const POLL_INTERVAL_MS = 5000;

export default function QueueDetailPage() {
  const params = useParams<{ id: string }>();
  const { user, loading } = useRequireAuth();
  const { authedRequest } = useAuth();

  const [queue, setQueue] = useState<QueueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);

  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setFetching(true);
      try {
        const data = await authedRequest<QueueDetail>(`/queues/${params.id}`);
        setQueue(data);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : 'Failed to load queue.');
      } finally {
        if (showSpinner) setFetching(false);
      }
    },
    [authedRequest, params.id],
  );

  useEffect(() => {
    if (!user) return;
    load(true);
    const interval = setInterval(() => load(false), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [user, load]);

  async function callNext() {
    setBusyEntryId('call-next');
    setError(null);
    try {
      await authedRequest(`/queues/${params.id}/call-next`, { method: 'POST' });
      await load(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to call next patient.');
    } finally {
      setBusyEntryId(null);
    }
  }

  async function entryAction(entryId: string, action: 'skip' | 'start' | 'complete' | 'cancel' | 'requeue') {
    setBusyEntryId(entryId);
    setError(null);
    try {
      await authedRequest(`/queue-entries/${entryId}/${action}`, { method: 'POST' });
      await load(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : `Failed to ${action}.`);
    } finally {
      setBusyEntryId(null);
    }
  }

  if (loading || !user) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const waiting = queue?.entries.filter((e) => e.status === 'WAITING') ?? [];
  const called = queue?.entries.filter((e) => e.status === 'CALLED') ?? [];
  const inConsultation = queue?.entries.filter((e) => e.status === 'IN_CONSULTATION') ?? [];
  const completed = queue?.entries.filter((e) => e.status === 'COMPLETED') ?? [];
  const skipped = queue?.entries.filter((e) => e.status === 'SKIPPED') ?? [];

  return (
    <AppShell>
      <div className="page-header">
        <h1>Queue</h1>
        <Link
          href="/queues"
          className="secondary"
          style={{ textDecoration: 'none', padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8 }}
        >
          Back to queues
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {fetching ? (
        <p className="muted">Loading…</p>
      ) : queue ? (
        <>
          <div className="panel">
            <div className="form-grid">
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Waiting
                </div>
                <div className="token-display">{waiting.length}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Called
                </div>
                <div className="token-display">{called.length}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  In consultation
                </div>
                <div className="token-display">{inConsultation.length}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Completed
                </div>
                <div className="token-display">{completed.length}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Skipped
                </div>
                <div className="token-display">{skipped.length}</div>
              </div>
            </div>
            <button
              className="primary"
              style={{ width: 'auto' }}
              onClick={callNext}
              disabled={busyEntryId === 'call-next' || waiting.length === 0}
            >
              {busyEntryId === 'call-next' ? 'Calling…' : 'Call next'}
            </button>
          </div>

          {called.length > 0 && (
            <div className="panel">
              <h2>Called — awaiting consultation start</h2>
              {called.map((entry) => (
                <div key={entry.id} className="action-row" style={{ alignItems: 'center', marginBottom: 8 }}>
                  <span className="badge">Token {entry.tokenNumber}</span>
                  <button
                    className="secondary"
                    disabled={busyEntryId === entry.id}
                    onClick={() => entryAction(entry.id, 'start')}
                  >
                    Start consultation
                  </button>
                  <button
                    className="secondary"
                    disabled={busyEntryId === entry.id}
                    onClick={() => entryAction(entry.id, 'skip')}
                  >
                    Skip
                  </button>
                  <button
                    className="secondary"
                    disabled={busyEntryId === entry.id}
                    onClick={() => entryAction(entry.id, 'cancel')}
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          )}

          {inConsultation.length > 0 && (
            <div className="panel">
              <h2>In consultation</h2>
              {inConsultation.map((entry) => (
                <div key={entry.id} className="action-row" style={{ alignItems: 'center', marginBottom: 8 }}>
                  <span className="badge">Token {entry.tokenNumber}</span>
                  <button
                    className="secondary"
                    disabled={busyEntryId === entry.id}
                    onClick={() => entryAction(entry.id, 'complete')}
                  >
                    Complete
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="panel">
            <h2>Waiting</h2>
            {waiting.length === 0 ? (
              <p className="muted">No one waiting.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>Joined</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {waiting.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.tokenNumber}</td>
                        <td className="muted">{new Date(entry.joinedAt).toLocaleTimeString()}</td>
                        <td>
                          <button
                            className="secondary"
                            disabled={busyEntryId === entry.id}
                            onClick={() => entryAction(entry.id, 'skip')}
                          >
                            Skip
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {skipped.length > 0 && (
            <div className="panel">
              <h2>Skipped</h2>
              <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
                Requeue gives the patient a fresh token at the back of the line.
              </p>
              {skipped.map((entry) => (
                <div key={entry.id} className="action-row" style={{ alignItems: 'center', marginBottom: 8 }}>
                  <span className="badge">Was token {entry.tokenNumber}</span>
                  <button
                    className="secondary"
                    disabled={busyEntryId === entry.id}
                    onClick={() => entryAction(entry.id, 'requeue')}
                  >
                    Requeue
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="muted">Queue not found.</p>
      )}
    </AppShell>
  );
}
