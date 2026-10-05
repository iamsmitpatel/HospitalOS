# HospitalOS Web

Staff-facing frontend. Phase 2 scope (master doc §44): authentication foundation only — registration (bootstrap), login, and a protected dashboard shell. Not a full hospital-management UI yet.

See `/ARCHITECTURE.md` for the module layout and session-handling design, `/SECURITY.md` for why the access token lives in memory only, and `/DECISIONS.md` for why this register page has no `hospitalName` field and why Next.js 14 was chosen over the `latest` tag.

## Run it

```bash
cp .env.local.example .env.local   # NEXT_PUBLIC_API_BASE_URL
npm run dev --workspace=apps/web   # http://localhost:3001 — matches the API's default CORS_ORIGIN
```

Requires the API running at the URL in `.env.local` (default `http://localhost:3000/api/v1`).

## Structure

```
src/
  app/
    layout.tsx       wraps the app in AuthProvider
    page.tsx          redirects to /dashboard or /login based on session state
    login/page.tsx
    register/page.tsx  bootstrap-only — see /DECISIONS.md
    dashboard/page.tsx  protected shell: name, role, hospital, logout
  lib/
    api-client.ts     the only place fetch() is called — base URL, auth header, error
                       normalization, single-flight silent refresh-and-retry on 401
    auth-context.tsx   React context: current user, in-memory access token, login/register/logout
```

When this grows beyond the auth shell, see master doc §23 for the expected feature-oriented structure (`features/auth`, `features/patients`, etc.) and §24 for why frontend route guards are UX only, never the actual security boundary — every API call still has to pass the backend's own auth/RBAC/tenant checks regardless of what the UI shows or hides.
