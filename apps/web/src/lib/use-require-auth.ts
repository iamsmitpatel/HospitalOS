'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-context';

/**
 * Redirect-if-unauthenticated for every operational page. UX convenience
 * only — the API enforces the real boundary (see /ARCHITECTURE.md).
 *
 * Also redirects a HospitalOS Connect (PATIENT-role) session away: a
 * patient can reach a valid session here via the silent-refresh-on-load
 * path, not just the login form (which already blocks this case on submit
 * — see login/page.tsx), so this is the one place that actually guards
 * every staff page regardless of how the session was established. There
 * is no patient-facing frontend yet, so the honest outcome is logging the
 * session back out, not rendering a staff dashboard full of links a
 * patient has no permission to use.
 */
export function useRequireAuth() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.role === 'PATIENT') {
      logout().finally(() => router.replace('/login?blocked=patient'));
    }
  }, [loading, user, router, logout]);

  return { user, loading };
}
