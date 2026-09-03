# Repository instructions

These instructions apply to the entire repository.

## Start every session

1. Read [`.agents/project-memory.md`](.agents/project-memory.md) before investigating the code.
2. Read [`SKILLS.md`](SKILLS.md) and use the relevant workflow for the task.
3. Check `git status --short` before editing. Treat pre-existing changes as user work and do not overwrite them.
4. Consult `README.md`, `package.json`, and the implementation only as needed; do not rediscover facts already captured accurately in project memory.

## Persistent project memory — required on every prompt

Before the final response to **every user prompt**, review what was learned during that prompt and update [`.agents/project-memory.md`](.agents/project-memory.md) when there is a new durable fact that would materially help a future session.

- Record stable architecture, domain rules, non-obvious coupling, authoritative commands, verification constraints, and confirmed project decisions.
- Integrate facts into the appropriate section. Deduplicate and replace stale facts instead of appending a chronological diary.
- Keep entries short, factual, and traceable to repository code or an explicit user decision.
- Do not record chat history, task progress, temporary environment state, guesses, obvious facts, one-off command output, secrets, credentials, personal data, or facts useful only to the current prompt.
- If a prompt yields no durable fact, leave the memory file unchanged. The required action is to evaluate memory on every prompt, not to manufacture an edit.
- When a change makes an existing memory entry inaccurate, correct or remove that entry in the same turn.

## Working rules

- This application stores business and session data in SQLite. Never delete, replace, seed, import into, or migrate a real database just to test a change.
- Use temporary paths for runtime verification, for example `DATABASE_PATH=/tmp/...` and `SESSION_DB_PATH=/tmp/...`.
- Schema changes belong in `database.js` and must remain safe for both a new database and an existing database upgraded in place.
- Preserve historical transaction snapshots: later catalog price/name changes must not rewrite sale or purchase history.
- Keep money rounding and stock synchronization behavior consistent with the server helpers; accounting changes require targeted regression checks.
- The frontend is intentionally build-free. Preserve script load order and existing shared globals unless the task explicitly introduces a bundling/module strategy.
- Prefer focused changes over unrelated cleanup. Several large frontend files and layered CSS files have order-dependent behavior.

## Verification baseline

- Install dependencies with `npm install` when required.
- Run `node --check` on every changed JavaScript file.
- For server/database changes, start the app against disposable SQLite paths with a temporary `SESSION_SECRET` of at least 32 characters and exercise the affected endpoint.
- There is currently no automated test suite; `npm test` is only a failing placeholder. State exactly which manual or syntax checks were performed.
