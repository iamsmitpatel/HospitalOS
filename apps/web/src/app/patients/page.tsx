'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api-client';

interface Patient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  phone: string;
  dateOfBirth: string;
  isActive: boolean;
}

interface PatientsPage {
  items: Patient[];
  total: number;
  page: number;
  pageSize: number;
}

const emptyForm = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: 'FEMALE',
  phone: '',
  email: '',
  addressLine: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
};

export default function PatientsPage() {
  const { user, loading } = useRequireAuth();
  const { authedRequest } = useAuth();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMrn, setSuccessMrn] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const canRegister = user && user.role !== 'PATIENT' && user.role !== 'ACCOUNTANT';

  const load = useCallback(
    async (searchTerm: string) => {
      setFetching(true);
      try {
        const query = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
        const data = await authedRequest<PatientsPage>(`/patients${query}`);
        setPatients(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : 'Failed to load patients.');
      } finally {
        setFetching(false);
      }
    },
    [authedRequest],
  );

  useEffect(() => {
    if (user) load(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    load(search);
  }

  async function handleRegister(event: FormEvent, confirmDuplicate = false) {
    event.preventDefault();
    setError(null);
    setDuplicateWarning(null);
    setSubmitting(true);
    try {
      const result = await authedRequest<{ mrn: string }>('/patients', {
        method: 'POST',
        body: {
          ...form,
          email: form.email || undefined,
          addressLine: form.addressLine || undefined,
          emergencyContactName: form.emergencyContactName || undefined,
          emergencyContactPhone: form.emergencyContactPhone || undefined,
          confirmDuplicate,
        },
      });
      setSuccessMrn(result.mrn);
      setForm(emptyForm);
      await load(search);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'POTENTIAL_DUPLICATE_PATIENT') {
        setDuplicateWarning(err.message);
      } else {
        setError(err instanceof ApiRequestError ? err.message : 'Failed to register patient.');
      }
    } finally {
      setSubmitting(false);
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
        <h1>Patients</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {successMrn && (
        <div className="success-banner">
          Patient registered successfully. MRN: <strong>{successMrn}</strong>
        </div>
      )}

      {canRegister && (
        <div className="panel">
          <h2>Register patient</h2>
          {duplicateWarning && (
            <div className="error-banner">
              {duplicateWarning}{' '}
              <button className="secondary" onClick={(e) => handleRegister(e, true)} disabled={submitting}>
                Register anyway
              </button>
            </div>
          )}
          <form onSubmit={(e) => handleRegister(e, false)}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="firstName">First name</label>
                <input
                  id="firstName"
                  required
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="lastName">Last name</label>
                <input
                  id="lastName"
                  required
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="dateOfBirth">Date of birth</label>
                <input
                  id="dateOfBirth"
                  type="date"
                  required
                  value={form.dateOfBirth}
                  onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="gender">Gender</label>
                <select
                  id="gender"
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                >
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="OTHER">Other</option>
                  <option value="UNKNOWN">Prefer not to say</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="phone">Phone</label>
                <input
                  id="phone"
                  required
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="addressLine">Address</label>
                <input
                  id="addressLine"
                  value={form.addressLine}
                  onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="emergencyContactName">Emergency contact name</label>
                <input
                  id="emergencyContactName"
                  value={form.emergencyContactName}
                  onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="emergencyContactPhone">Emergency contact phone</label>
                <input
                  id="emergencyContactPhone"
                  value={form.emergencyContactPhone}
                  onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })}
                />
              </div>
            </div>
            <div className="form-actions">
              <button className="primary" type="submit" disabled={submitting} style={{ width: 'auto' }}>
                {submitting ? 'Registering…' : 'Register patient'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="panel">
        <form onSubmit={handleSearchSubmit} className="form-actions">
          <input
            placeholder="Search by name, MRN, or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
            }}
          />
          <button className="secondary" type="submit">
            Search
          </button>
        </form>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>MRN</th>
              <th>Name</th>
              <th>Phone</th>
              <th>DOB</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {fetching ? (
              <tr>
                <td colSpan={5} className="muted">
                  Loading…
                </td>
              </tr>
            ) : patients.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No patients found.
                </td>
              </tr>
            ) : (
              patients.map((p) => (
                <tr key={p.id}>
                  <td>{p.mrn}</td>
                  <td>
                    <Link href={`/patients/${p.id}`}>
                      {p.firstName} {p.lastName}
                    </Link>
                  </td>
                  <td className="muted">{p.phone}</td>
                  <td className="muted">{p.dateOfBirth.slice(0, 10)}</td>
                  <td>
                    <span className="badge">{p.isActive ? 'Active' : 'Inactive'}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        {total} total
      </p>
    </AppShell>
  );
}
