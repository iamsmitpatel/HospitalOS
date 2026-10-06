'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/departments', label: 'Departments' },
  { href: '/doctors', label: 'Doctors' },
  { href: '/patients', label: 'Patients' },
  { href: '/appointments', label: 'Appointments' },
  { href: '/queues', label: 'Queues' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <strong>HospitalOS</strong>
          <nav className="app-nav">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={pathname?.startsWith(link.href) ? 'app-nav-link active' : 'app-nav-link'}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="app-header-right">
          {user && (
            <span className="muted">
              {user.firstName} {user.lastName} · <span className="badge">{user.role}</span>
            </span>
          )}
          <button className="secondary" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
