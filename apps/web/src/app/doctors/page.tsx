'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api-client';

interface Doctor {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  specialization: string;
  displayName: string;
  departmentId: string;
  status: string;
}

interface Department {
  id: string;
  name: string;
}

interface UserSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

export default function DoctorsPage() {
  const { user, loading } = useRequireAuth();
  const { authedRequest } = useAuth();

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctorUsers, setDoctorUsers] = useState<UserSummary[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canManage = user?.role === 'HOSPITAL_ADMIN' || user?.role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const [doctorList, departmentList, userList] = await Promise.all([
        authedRequest<Doctor[]>('/doctors'),
        authedRequest<Department[]>('/departments'),
        authedRequest<UserSummary[]>('/users'),
      ]);
      setDoctors(doctorList);
      setDepartments(departmentList);
      const alreadyDoctors = new Set(doctorList.map((d) => d.email));
      setDoctorUsers(userList.filter((u) => u.role === 'DOCTOR' && !alreadyDoctors.has(u.email)));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to load doctors.');
    } finally {
      setFetching(false);
    }
  }, [authedRequest]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authedRequest('/doctors', {
        method: 'POST',
        body: { userId, departmentId, specialization },
      });
      setUserId('');
      setDepartmentId('');
      setSpecialization('');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to create doctor profile.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(doctorId: string, status: string) {
    setError(null);
    try {
      await authedRequest(`/doctors/${doctorId}`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to update doctor.');
    }
  }

  if (loading || !user) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const departmentName = (id: string) => departments.find((d) => d.id === id)?.name ?? id;

  return (
    <AppShell>
      <div className="page-header">
        <h1>Doctors</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {canManage && (
        <div className="panel">
          <h2>Add doctor profile</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
            The account must already exist with role DOCTOR (create it under Users) before a professional
            profile can be attached here.
          </p>
          <form onSubmit={handleCreate}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="userId">Doctor account</label>
                <select id="userId" required value={userId} onChange={(e) => setUserId(e.target.value)}>
                  <option value="">Select…</option>
                  {doctorUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="departmentId">Department</label>
                <select
                  id="departmentId"
                  required
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="specialization">Specialization</label>
                <input
                  id="specialization"
                  required
                  value={specialization}
                  onChange={(e) => setSpecialization(e.target.value)}
                />
              </div>
            </div>
            <div className="form-actions">
              <button
                className="primary"
                type="submit"
                disabled={submitting || doctorUsers.length === 0}
                style={{ width: 'auto' }}
              >
                {submitting ? 'Adding…' : 'Add doctor'}
              </button>
              {doctorUsers.length === 0 && (
                <span className="muted">No unattached DOCTOR-role accounts available.</span>
              )}
            </div>
          </form>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Specialization</th>
              <th>Department</th>
              <th>Status</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {fetching ? (
              <tr>
                <td colSpan={5} className="muted">
                  Loading…
                </td>
              </tr>
            ) : doctors.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No doctors yet.
                </td>
              </tr>
            ) : (
              doctors.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.displayName}</td>
                  <td>{doc.specialization}</td>
                  <td className="muted">{departmentName(doc.departmentId)}</td>
                  <td>
                    <span className="badge">{doc.status}</span>
                  </td>
                  {canManage && (
                    <td>
                      {doc.status === 'ACTIVE' ? (
                        <button className="secondary" onClick={() => handleStatusChange(doc.id, 'INACTIVE')}>
                          Deactivate
                        </button>
                      ) : (
                        <button className="secondary" onClick={() => handleStatusChange(doc.id, 'ACTIVE')}>
                          Reactivate
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
