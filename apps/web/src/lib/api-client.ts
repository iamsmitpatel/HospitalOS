/**
 * Single API client used by every page/component — no component should call
 * fetch() directly (master doc §46). Handles the base URL, the response
 * envelope ({ success, data } / { success: false, error }), attaching the
 * access token, and transparently retrying once after a silent refresh on a
 * 401 (the refresh token itself lives in an httpOnly cookie the browser
 * sends automatically; see /SECURITY.md and /DECISIONS.md).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export interface ApiErrorBody {
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, error: ApiErrorBody) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
  /** Set on the retry attempt itself, and on calls that must never trigger a refresh loop (e.g. /auth/refresh). */
  skipAuthRetry?: boolean;
}

async function rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include', // sends the httpOnly refresh_token cookie to /auth/*
    headers: {
      'Content-Type': 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const error: ApiErrorBody = json?.error ?? {
      code: 'UNKNOWN_ERROR',
      message: 'Something went wrong. Please try again.',
    };
    throw new ApiRequestError(response.status, error);
  }

  return json.data as T;
}

let inFlightRefresh: Promise<string | null> | null = null;

/** Single-flight: concurrent 401s during the same tick share one refresh call instead of racing. */
export function refreshAccessToken(): Promise<string | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = rawRequest<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      skipAuthRetry: true,
    })
      .then((data) => data.accessToken)
      .catch(() => null)
      .finally(() => {
        inFlightRefresh = null;
      });
  }
  return inFlightRefresh;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
  onTokenRefreshed?: (newAccessToken: string) => void,
): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401 && !options.skipAuthRetry) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        onTokenRefreshed?.(newToken);
        return rawRequest<T>(path, { ...options, accessToken: newToken, skipAuthRetry: true });
      }
    }
    throw error;
  }
}
