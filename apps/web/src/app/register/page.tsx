'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { ApiRequestError } from '@/lib/api-client';

/**
 * This is intentionally NOT a general "create your account" page. The API's
 * POST /auth/register only succeeds once, ever — it creates the platform's
 * first SUPER_ADMIN and then returns 403 REGISTRATION_CLOSED for every call
 * after that (see /DECISIONS.md: "/auth/register is bootstrap-only, not
 * general self-registration"). There is deliberately no hospitalName field
 * here — hospitals are created afterward by that SUPER_ADMIN, and hospital
 * admins/staff are created through the authenticated Users module, not
 * public self-registration (master doc §44 scope is this bootstrap screen
 * only, not a full hospital-management UI).
 */
export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ firstName, lastName, email, password });
      router.push('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Unable to create the account. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h1>Set up HospitalOS</h1>
        <p className="subtitle">
          Creates the platform&apos;s first Super Admin account. This only works once — every other
          account is created afterward from inside the platform.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="firstName">First name</label>
            <input
              id="firstName"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="lastName">Last name</label>
            <input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
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
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create admin account'}
          </button>
        </form>

        <p className="footer-link">
          Already set up? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
