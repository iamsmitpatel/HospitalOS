# HospitalOS Web (reserved)

Not yet scaffolded. Phase 1 (master doc §27) scope is backend foundation only — authentication, RBAC, tenant model, users, hospitals. The Next.js frontend for hospital staff (`HospitalOS Web`) starts once there's a real feature for it to drive; see `/ARCHITECTURE.md` and `/DECISIONS.md` for why frontend scaffolding wasn't pulled into Phase 1.

When this starts, see master doc §23 for the expected feature-oriented structure (`features/auth`, `features/patients`, etc.) and §24 for why frontend route guards are UX only, never the actual security boundary — every API call still has to pass the backend's own auth/RBAC/tenant checks regardless of what the UI shows or hides.
