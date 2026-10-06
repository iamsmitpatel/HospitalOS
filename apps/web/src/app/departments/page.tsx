'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api-client';

interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
}

export default function DepartmentsPage() {
  const { user, loading } = useRequireAuth();
  const { authedRequest } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canManage = user?.role === 'HOSPITAL_ADMIN' || user?.role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const data = await authedRequest<Department[]>('/departments');
      setDepartments(data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to load departments.');
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
      await authedRequest('/departments', {
        method: 'POST',
        body: { name, code: code.toUpperCase(), description: description || undefined },
      });
      setName('');
      setCode('');
      setDescription('');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to create department.');
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
        <h1>Departments</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {canManage && (
        <div className="panel">
          <h2>New department</h2>
          <form onSubmit={handleCreate}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="code">Code</label>
                <input
                  id="code"
                  required
                  maxLength={10}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="CARD"
                />
              </div>
              <div className="field">
                <label htmlFor="description">Description</label>
                <input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
            <div className="form-actions">
              <button className="primary" type="submit" disabled={submitting} style={{ width: 'auto' }}>
                {submitting ? 'Creating…' : 'Create department'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {fetching ? (
              <tr>
                <td colSpan={4} className="muted">
                  Loading…
                </td>
              </tr>
            ) : departments.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No departments yet.
                </td>
              </tr>
            ) : (
              departments.map((dept) => (
                <tr key={dept.id}>
                  <td>{dept.name}</td>
                  <td>{dept.code}</td>
                  <td className="muted">{dept.description ?? '—'}</td>
                  <td>
                    <span className="badge">{dept.isActive ? 'Active' : 'Inactive'}</span>
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
