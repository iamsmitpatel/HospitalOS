'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

/**
 * Protected shell only (master doc §44) — not the full hospital dashboard.
 * This redirect is a UX convenience, not a security boundary: every API
 * call the dashboard makes is independently authenticated and authorized by
 * the backend regardless of what this page shows or hides (see
 * /apps/web/README.md and /SECURITY.md).
 */
export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="dashboard">
      <header>
        <strong>HospitalOS</strong>
        <button className="secondary" onClick={handleLogout}>
          Log out
        </button>
      </header>
      <main>
        <h1>
          Welcome, {user.firstName} {user.lastName}
        </h1>
        <p>
          <span className="badge">{user.role}</span>
        </p>
        <p className="muted">
          {user.hospital ? `Hospital: ${user.hospital.name}` : 'Platform administrator — no hospital scope'}
        </p>
        <p className="muted">{user.email}</p>
      </main>
    </div>
  );
}
