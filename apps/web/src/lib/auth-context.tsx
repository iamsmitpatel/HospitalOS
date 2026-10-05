'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiRequest, refreshAccessToken } from './api-client';

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  hospital: { id: string; name: string } | null;
}

interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

interface AuthContextValue {
  user: CurrentUser | null;
  /** True only while bootstrapping the session on first load (silent refresh + /me). */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCurrentUser = useCallback(async (token: string) => {
    const me = await apiRequest<CurrentUser>('/auth/me', { accessToken: token }, setAccessToken);
    setUser(me);
  }, []);

  useEffect(() => {
    // The access token lives in memory only (never localStorage/sessionStorage,
    // to limit XSS exposure — see /SECURITY.md), so a full page reload loses
    // it. Silently try the httpOnly refresh cookie to re-establish a session
    // before deciding the user is logged out (master doc §45).
    let cancelled = false;
    (async () => {
      const token = await refreshAccessToken();
      if (cancelled) return;
      if (token) {
        setAccessToken(token);
        try {
          await loadCurrentUser(token);
        } catch {
          if (!cancelled) {
            setUser(null);
            setAccessToken(null);
          }
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCurrentUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiRequest<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: { email, password },
        skipAuthRetry: true,
      });
      setAccessToken(result.accessToken);
      await loadCurrentUser(result.accessToken);
    },
    [loadCurrentUser],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const result = await apiRequest<{ accessToken: string }>('/auth/register', {
        method: 'POST',
        body: input,
        skipAuthRetry: true,
      });
      setAccessToken(result.accessToken);
      await loadCurrentUser(result.accessToken);
    },
    [loadCurrentUser],
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST', accessToken, skipAuthRetry: true });
    } finally {
      setUser(null);
      setAccessToken(null);
    }
  }, [accessToken]);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
