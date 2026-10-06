'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api-client';

interface PatientDetail {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email: string | null;
  addressLine: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  isActive: boolean;
}

export default function PatientDetailPage() {
  const params = useParams<{ id: string }>();
  const { user, loading } = useRequireAuth();
  const { authedRequest } = useAuth();

  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const data = await authedRequest<PatientDetail>(`/patients/${params.id}`);
      setPatient(data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to load patient.');
    } finally {
      setFetching(false);
    }
  }, [authedRequest, params.id]);

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

  return (
    <AppShell>
      <div className="page-header">
        <h1>Patient</h1>
        <Link href="/patients" className="secondary" style={{ textDecoration: 'none', padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8 }}>
          Back to patients
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {fetching ? (
        <p className="muted">Loading…</p>
      ) : patient ? (
        <>
          <div className="panel">
            <h2>
              {patient.firstName} {patient.lastName}{' '}
              <span className="badge">{patient.isActive ? 'Active' : 'Inactive'}</span>
            </h2>
            <p className="muted">MRN: {patient.mrn}</p>
            <div className="form-grid" style={{ marginTop: 16 }}>
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Date of birth
                </div>
                <div>{patient.dateOfBirth.slice(0, 10)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Gender
                </div>
                <div>{patient.gender}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Phone
                </div>
                <div>{patient.phone}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Email
                </div>
                <div>{patient.email ?? '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Address
                </div>
                <div>{patient.addressLine ?? '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Emergency contact
                </div>
                <div>
                  {patient.emergencyContactName ?? '—'}
                  {patient.emergencyContactPhone ? ` (${patient.emergencyContactPhone})` : ''}
                </div>
              </div>
            </div>
          </div>

          <div className="action-row">
            <Link href={`/appointments?patientId=${patient.id}`} className="primary" style={{ textDecoration: 'none', padding: '10px 16px', borderRadius: 8, background: 'var(--accent)', color: 'white' }}>
              Book appointment
            </Link>
          </div>
        </>
      ) : (
        <p className="muted">Patient not found.</p>
      )}
    </AppShell>
  );
}
