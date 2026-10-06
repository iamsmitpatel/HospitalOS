'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api-client';

interface AppointmentDetail {
  id: string;
  patientId: string;
  doctorProfileId: string;
  scheduledAt: string;
  status: string;
  reason: string | null;
  cancellationReason: string | null;
}

const CHECK_IN_ELIGIBLE = ['SCHEDULED', 'CONFIRMED'];
const CANCELLABLE = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_QUEUE'];
const RESCHEDULABLE = ['SCHEDULED', 'CONFIRMED'];

export default function AppointmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useRequireAuth();
  const { authedRequest } = useAuth();

  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rescheduleSlots, setRescheduleSlots] = useState<string[]>([]);
  const [rescheduleDate, setRescheduleDate] = useState('');

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const data = await authedRequest<AppointmentDetail>(`/appointments/${params.id}`);
      setAppointment(data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to load appointment.');
    } finally {
      setFetching(false);
    }
  }, [authedRequest, params.id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function handleCancel() {
    if (!appointment) return;
    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/appointments/${appointment.id}/cancel`, { method: 'POST', body: {} });
      setMessage('Appointment cancelled.');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to cancel.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckIn() {
    if (!appointment) return;
    setBusy(true);
    setError(null);
    try {
      const entry = await authedRequest<{ queueId: string }>('/queue-entries', {
        method: 'POST',
        body: { appointmentId: appointment.id },
      });
      router.push(`/queues/${entry.queueId}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to check in.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadRescheduleSlots(event: FormEvent) {
    event.preventDefault();
    if (!appointment || !rescheduleDate) return;
    setError(null);
    try {
      const result = await authedRequest<string[]>(
        `/doctors/${appointment.doctorProfileId}/available-slots?date=${rescheduleDate}`,
      );
      setRescheduleSlots(result);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to load slots.');
    }
  }

  async function handleReschedule(newSlot: string) {
    if (!appointment) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authedRequest<AppointmentDetail>(`/appointments/${appointment.id}/reschedule`, {
        method: 'POST',
        body: { scheduledAt: newSlot },
      });
      router.push(`/appointments/${result.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to reschedule.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="page-header">
        <h1>Appointment</h1>
        <Link
          href="/appointments"
          className="secondary"
          style={{ textDecoration: 'none', padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8 }}
        >
          Back to appointments
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {message && <div className="success-banner">{message}</div>}

      {fetching ? (
        <p className="muted">Loading…</p>
      ) : appointment ? (
        <>
          <div className="panel">
            <h2>
              <span className="badge">{appointment.status}</span>
            </h2>
            <p className="muted">{new Date(appointment.scheduledAt).toLocaleString()}</p>
            {appointment.reason && <p>Reason: {appointment.reason}</p>}
            {appointment.cancellationReason && (
              <p className="muted">Cancellation reason: {appointment.cancellationReason}</p>
            )}

            <div className="action-row" style={{ marginTop: 16 }}>
              {CHECK_IN_ELIGIBLE.includes(appointment.status) && (
                <button className="primary" style={{ width: 'auto' }} onClick={handleCheckIn} disabled={busy}>
                  Check in
                </button>
              )}
              {CANCELLABLE.includes(appointment.status) && (
                <button className="secondary" onClick={handleCancel} disabled={busy}>
                  Cancel appointment
                </button>
              )}
            </div>
          </div>

          {RESCHEDULABLE.includes(appointment.status) && (
            <div className="panel">
              <h2>Reschedule</h2>
              <form onSubmit={handleLoadRescheduleSlots} className="form-actions" style={{ marginBottom: 12 }}>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                />
                <button className="secondary" type="submit">
                  Find slots
                </button>
              </form>
              {rescheduleSlots.length > 0 && (
                <div className="slot-grid">
                  {rescheduleSlots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className="slot"
                      disabled={busy}
                      onClick={() => handleReschedule(slot)}
                    >
                      {new Date(slot).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="muted">Appointment not found.</p>
      )}
    </AppShell>
  );
}
