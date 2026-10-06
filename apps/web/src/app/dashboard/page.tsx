'use client';

import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();

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
        <h1>
          Welcome, {user.firstName} {user.lastName}
        </h1>
      </div>
      <div className="panel">
        <p>
          <span className="badge">{user.role}</span>
        </p>
        <p className="muted">
          {user.hospital ? `Hospital: ${user.hospital.name}` : 'Platform administrator — no hospital scope'}
        </p>
        <p className="muted">{user.email}</p>
      </div>
    </AppShell>
  );
}
