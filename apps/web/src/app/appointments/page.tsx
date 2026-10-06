'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api-client';

interface Appointment {
  id: string;
  patientId: string;
  doctorProfileId: string;
  scheduledAt: string;
  status: string;
  reason: string | null;
}

interface AppointmentsPageData {
  items: Appointment[];
  total: number;
}

interface PatientOption {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
}

interface DoctorOption {
  id: string;
  displayName: string;
}

export default function AppointmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <p className="muted">Loading…</p>
        </div>
      }
    >
      <AppointmentsPageInner />
    </Suspense>
  );
}

function AppointmentsPageInner() {
  const { user, loading } = useRequireAuth();
  const { authedRequest } = useAuth();
  const searchParams = useSearchParams();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [patientId, setPatientId] = useState(searchParams.get('patientId') ?? '');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState(false);

  const canManage = user && user.role !== 'PATIENT' && user.role !== 'ACCOUNTANT' && user.role !== 'PHARMACIST' && user.role !== 'LAB_TECHNICIAN';

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const query = statusFilter ? `?status=${statusFilter}&pageSize=50` : '?pageSize=50';
      const [apptData, patientData, doctorData] = await Promise.all([
        authedRequest<AppointmentsPageData>(`/appointments${query}`),
        authedRequest<{ items: PatientOption[] }>('/patients?pageSize=100'),
        authedRequest<DoctorOption[]>('/doctors'),
      ]);
      setAppointments(apptData.items);
      setPatients(patientData.items);
      setDoctors(doctorData);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to load appointments.');
    } finally {
      setFetching(false);
    }
  }, [authedRequest, statusFilter]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function handleLoadSlots() {
    if (!doctorId || !date) return;
    setError(null);
    setLoadingSlots(true);
    setSlots([]);
    setSelectedSlot('');
    try {
      const result = await authedRequest<string[]>(`/doctors/${doctorId}/available-slots?date=${date}`);
      setSlots(result);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to load available slots.');
    } finally {
      setLoadingSlots(false);
    }
  }

  async function handleBook(event: FormEvent) {
    event.preventDefault();
    if (!selectedSlot) return;
    setError(null);
    setBooking(true);
    try {
      await authedRequest('/appointments', {
        method: 'POST',
        body: { patientId, doctorProfileId: doctorId, scheduledAt: selectedSlot, reason: reason || undefined },
      });
      setSuccess('Appointment booked successfully.');
      setSlots([]);
      setSelectedSlot('');
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to book appointment.');
    } finally {
      setBooking(false);
    }
  }

  async function handleCancel(id: string) {
    setError(null);
    try {
      await authedRequest(`/appointments/${id}/cancel`, { method: 'POST', body: {} });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to cancel appointment.');
    }
  }

  if (loading || !user) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const patientLabel = (id: string) => {
    const p = patients.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName} (${p.mrn})` : id;
  };
  const doctorLabel = (id: string) => doctors.find((d) => d.id === id)?.displayName ?? id;

  return (
    <AppShell>
      <div className="page-header">
        <h1>Appointments</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      {canManage && (
        <div className="panel">
          <h2>Book appointment</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="patientId">Patient</label>
              <select id="patientId" required value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                <option value="">Select…</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName} ({p.mrn})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="doctorId">Doctor</label>
              <select id="doctorId" required value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">Select…</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="date">Date</label>
              <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="form-actions" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className="secondary"
              onClick={handleLoadSlots}
              disabled={!doctorId || !date || loadingSlots}
            >
              {loadingSlots ? 'Loading slots…' : 'Find available slots'}
            </button>
          </div>

          {slots.length > 0 && (
            <>
              <div className="slot-grid">
                {slots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    className={selectedSlot === slot ? 'slot selected' : 'slot'}
                    onClick={() => setSelectedSlot(slot)}
                  >
                    {new Date(slot).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </button>
                ))}
              </div>
              <form onSubmit={handleBook}>
                <div className="field">
                  <label htmlFor="reason">Reason (optional)</label>
                  <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <div className="form-actions">
                  <button
                    className="primary"
                    type="submit"
                    disabled={!selectedSlot || !patientId || booking}
                    style={{ width: 'auto' }}
                  >
                    {booking ? 'Booking…' : 'Book appointment'}
                  </button>
                </div>
              </form>
            </>
          )}
          {slots.length === 0 && !loadingSlots && doctorId && date && (
            <p className="muted">No available slots loaded yet, or none are free on this date.</p>
          )}
        </div>
      )}

      <div className="panel">
        <div className="field" style={{ maxWidth: 240 }}>
          <label htmlFor="statusFilter">Filter by status</label>
          <select id="statusFilter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="IN_QUEUE">In queue</option>
            <option value="IN_CONSULTATION">In consultation</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="NO_SHOW">No-show</option>
          </select>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Time</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {fetching ? (
              <tr>
                <td colSpan={5} className="muted">
                  Loading…
                </td>
              </tr>
            ) : appointments.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No appointments found.
                </td>
              </tr>
            ) : (
              appointments.map((a) => (
                <tr key={a.id}>
                  <td>{patientLabel(a.patientId)}</td>
                  <td className="muted">{doctorLabel(a.doctorProfileId)}</td>
                  <td className="muted">{new Date(a.scheduledAt).toLocaleString()}</td>
                  <td>
                    <span className="badge">{a.status}</span>
                  </td>
                  <td>
                    <div className="action-row">
                      <Link href={`/appointments/${a.id}`}>View</Link>
                      {['SCHEDULED', 'CONFIRMED', 'IN_QUEUE'].includes(a.status) && (
                        <button className="secondary" onClick={() => handleCancel(a.id)}>
                          Cancel
                        </button>
                      )}
                    </div>
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
