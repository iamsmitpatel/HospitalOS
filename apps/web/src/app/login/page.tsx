'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api-client';

const PATIENT_BLOCKED_MESSAGE =
  'This is the hospital staff portal. HospitalOS Connect (the patient app) is not available yet.';

export default function LoginPage() {
  const { login, logout } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Reached via useRequireAuth's redirect (an already-signed-in Connect
    // patient navigating straight to a staff URL, not via this form) —
    // read directly from the browser rather than useSearchParams(), which
    // would force this otherwise-static page to opt out of prerendering
    // for a one-off query param.
    if (new URLSearchParams(window.location.search).get('blocked') === 'patient') {
      setError(PATIENT_BLOCKED_MESSAGE);
    }
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      if (user.role === 'PATIENT') {
        // A HospitalOS Connect patient account — valid credentials, but this
        // is the staff portal (see the subtitle below). There is no
        // patient-facing frontend yet (Connect is API-only so far), so the
        // honest response is a clear message, not a staff dashboard full of
        // links a patient has no permission to use. Immediately logs the
        // session back out rather than leaving a half-signed-in state.
        await logout();
        setError(PATIENT_BLOCKED_MESSAGE);
        return;
      }
      router.push('/dashboard');
    } catch (err) {
      // Generic message regardless of failure reason — the API itself never
      // distinguishes "no such account" from "wrong password" (see /SECURITY.md).
      setError(err instanceof ApiRequestError ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h1>Sign in</h1>
        <p className="subtitle">HospitalOS staff portal</p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="footer-link">
          Platform setup? <Link href="/register">Create the first admin account</Link>
        </p>
      </div>
    </div>
  );
}
