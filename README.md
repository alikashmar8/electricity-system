# Dakkak Electric

## Project documentation

- [Production-readiness roadmap](docs/production-readiness/README.md)
- [Repository working instructions](AGENTS.md)
- [Project playbook](SKILLS.md)

## Production deployment

The application is served by Node.js/Express and keeps business data and login sessions in SQLite. Production SQLite files **must be placed on persistent storage**; an ephemeral application filesystem will lose data during restarts or redeploys.

Supported environment variables:

- `NODE_ENV`: use `development` locally and `production` online.
- `PORT`: hosting-provided HTTP port; defaults to `3000`.
- `SESSION_SECRET`: required random secret of at least 32 characters.
- `COOKIE_SECURE`: `false` for local HTTP and `true` for production HTTPS.
- `TRUST_PROXY`: `0` locally; set the appropriate trusted proxy hop count in production.
- `DATABASE_PATH`: optional business SQLite path. Defaults to `database/sandbox.db`.
- `SESSION_DB_PATH`: optional session SQLite path. Defaults to `database/sessions.sqlite`.

For hosted deployment, point both database paths to persistent storage, install with `npm install`, and start with `npm start`. HTTPS certificates can remain managed by the hosting provider or reverse proxy.
