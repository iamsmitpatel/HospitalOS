'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api-client';

interface QueueSummary {
  id: string;
  doctorProfileId: string | null;
  queueDate: string;
  isActive: boolean;
}

interface DoctorOption {
  id: string;
  displayName: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function QueuesPage() {
  const { user, loading } = useRequireAuth();
  const { authedRequest } = useAuth();

  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [date, setDate] = useState(todayIso());
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const [queueData, doctorData] = await Promise.all([
        authedRequest<QueueSummary[]>(`/queues?date=${date}`),
        authedRequest<DoctorOption[]>('/doctors'),
      ]);
      setQueues(queueData);
      setDoctors(doctorData);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to load queues.');
    } finally {
      setFetching(false);
    }
  }, [authedRequest, date]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading || !user) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const doctorLabel = (id: string | null) => (id ? doctors.find((d) => d.id === id)?.displayName ?? id : 'Department queue');

  return (
    <AppShell>
      <div className="page-header">
        <h1>Queues</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Doctor</th>
              <th>Date</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fetching ? (
              <tr>
                <td colSpan={4} className="muted">
                  Loading…
                </td>
              </tr>
            ) : queues.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No queues for this date yet — they&apos;re created automatically on first check-in.
                </td>
              </tr>
            ) : (
              queues.map((q) => (
                <tr key={q.id}>
                  <td>{doctorLabel(q.doctorProfileId)}</td>
                  <td className="muted">{q.queueDate.slice(0, 10)}</td>
                  <td>
                    <span className="badge">{q.isActive ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td>
                    <Link href={`/queues/${q.id}`}>Open</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
