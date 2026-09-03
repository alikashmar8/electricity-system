# Security and accountability

## Outcome

Users can perform only their assigned jobs, sensitive actions are attributable, and an internet-facing deployment has layered protection beyond a login screen.

## Identity and authorization

- [ ] **SEC-01 — P0: Define a permission matrix.** Start with owner/admin, manager, cashier, inventory, and read-only candidates; remove roles the client does not need.
  - Acceptance: every API capability maps to an explicit permission approved in REQ-02.
- [ ] **SEC-02 — P0: Enforce authorization server-side.** Apply permissions to every read and mutation route; hiding UI controls is not authorization.
  - Acceptance: integration tests prove each role is allowed or denied for every endpoint category.
- [ ] **SEC-03 — P0: Protect destructive actions.** Restrict reset, deletes, stock resets/counts, payment changes, price changes, import, and settings changes separately.
  - Acceptance: high-risk actions require the intended permission and deliberate confirmation; bypass attempts return `403`.
- [ ] **SEC-04 — P1: User lifecycle administration.** Add owner-controlled user creation, deactivation, role change, password reset, and session revocation.
  - Acceptance: former employees lose access immediately and user administration itself is audited.

## Audit trail

- [ ] **SEC-05 — P0: Create an append-only audit event model.** Capture actor, action, entity type/id, time, request correlation ID, and safe before/after summaries.
  - Acceptance: all financial, inventory, catalog, authentication, user, import, export, and settings mutations create an audit event in the same transaction when feasible.
- [ ] **SEC-06 — P0: Make corrections traceable.** Prefer void/reversal records for financial events; protect audit records from ordinary application deletion.
  - Acceptance: a reviewer can reconstruct who changed a balance and why without relying on server logs.

## Web and account hardening

- [ ] **SEC-07 — P0: Add CSRF/origin protection.** Protect cookie-authenticated mutations and reject untrusted origins.
  - Acceptance: cross-site form/fetch attempts cannot perform a state-changing action.
- [ ] **SEC-08 — P0: Add security headers.** Configure CSP, frame protection, MIME sniffing protection, referrer policy, and strict transport security where HTTPS is guaranteed.
  - Acceptance: headers pass an agreed automated check without breaking the build-free frontend.
- [ ] **SEC-09 — P0: Harden cookies and sessions.** Validate secure-cookie/proxy configuration, rotate sessions after login, periodically prune expired sessions, and define idle/absolute timeouts.
  - Acceptance: production cookies are HTTPS-only and session fixation/expired-session tests pass.
- [ ] **SEC-10 — P0: Expand abuse controls.** Rate-limit or otherwise control authentication and expensive/high-impact APIs; cap input sizes and pagination consistently.
  - Acceptance: expected shop use remains responsive while abusive requests are rejected and logged.
- [ ] **SEC-11 — P0: Dependency and secret hygiene.** Resolve current audit findings, add repeatable vulnerability checks, pin production installs with the lockfile, and keep secrets outside source control.
  - Acceptance: the release has no unaccepted high/critical findings, all accepted findings have rationale/expiry, and secret scanning is clean.
- [ ] **SEC-12 — P1: Independent security review.** Review authentication, authorization, injection, XSS, CSRF, file upload, data exposure, deployment, and backup access.
  - Acceptance: `P0`/`P1` findings are fixed or formally accepted before launch.

## Operational security

- [ ] **SEC-13 — P1: Minimize host privileges.** Run as a dedicated non-root account with only required database and asset access.
- [ ] **SEC-14 — P1: Protect administration paths.** Decide whether management access requires VPN/LAN restriction, IP controls, or stronger authentication.
- [ ] **SEC-15 — P1: Incident response.** Document credential compromise, suspicious activity, data breach, lost device, and employee departure procedures.

