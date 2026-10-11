# Secure AI API Gateway & Chat System

A TypeScript/Express gateway and React chat application with PostgreSQL-backed
operational analytics. Provider API keys and conversations stay in memory. Only
allowlisted request metadata is persisted. The provider protocol is OpenAI-style;
multi-provider routing and streaming are not implemented.

## Architecture

```text
Browser → security/validation middleware → chat route → upstream service → provider
                    ↓ response finish/connection close (once)
           metadata-only bounded queue → usage repository → PostgreSQL

Local administrator → local boundary + HttpOnly session → analytics route
                    → analytics service → aggregate repository queries
```

```text
backend/
  src/
    config/          validated environment and root .env loading
    db/              pooled client, schema, SQL migrations, migration/prune CLI
    middleware/      security, request context, telemetry and local admin sessions
    repositories/    parameterized persistence, aggregation and retention
    routes/          chat, health, session and analytics HTTP endpoints
    services/        upstream client, usage normalization, queue, analytics, retention
    types/           operational metadata and chat contracts
    validation/      strict Zod chat and analytics schemas
    app.ts           injectable application composition
    server.ts        runtime dependencies and bounded graceful shutdown
  tests/             unit, HTTP, real PostgreSQL and browser-server fixtures
frontend/
  src/components/    existing chat controls and optional analytics dashboard
  src/services/      typed chat and cookie-authenticated analytics clients
  src/types/         response interfaces
  tests/             desktop/mobile Playwright regression and live integration tests
compose.yaml         loopback-only development and disposable test PostgreSQL
```

## Local setup

Use Node.js 22.12+ (supported LTS 22 or 24), npm, and Docker Compose v2. A native
PostgreSQL 17 server also works. Run commands from the repository root.

```sh
npm ci
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env`. Change `POSTGRES_PASSWORD` and the
matching URL-encoded password in `DATABASE_URL`. The backend loads the root `.env`
automatically; existing process environment takes precedence. Never commit `.env`.

```sh
docker compose up -d --wait postgres
npm run db:migrate --workspace backend
npm run dev:backend
```

In another terminal:

```sh
npm run dev:frontend
```

Open `http://localhost:5173`; the API listens on port 4000. Use the same hostname
for both sides (`localhost` with `localhost`) when using analytics session cookies.
The frontend defaults to `http://localhost:4000`; an optional frontend
`VITE_API_BASE_URL` configures another backend. Never put secrets in `VITE_*` values.
For chat without persistence, omit `DATABASE_URL`; authenticated analytics then
returns 503. A configured database outage also leaves valid chat available.

Build and run:

```sh
npm run build
npm run start --workspace backend
```

Serve `frontend/dist` using your deployment's static server. Preserve
`backend/src/db/migrations` alongside `backend/dist` when packaging the migration
CLI. Apply migrations as an explicit release step; application startup never
silently changes the schema.

## Database schema and lifecycle

The versioned Drizzle schema creates `ai_requests`:

| Column | Meaning |
| --- | --- |
| `request_id` | Server-generated UUID primary key; duplicate writes are ignored |
| `timestamp` | Request start time as `timestamptz` |
| `model` | Configured model identifier, up to 128 characters |
| `duration_ms` | Monotonic elapsed time to HTTP completion or connection close |
| `prompt_tokens`, `completion_tokens`, `total_tokens` | Nullable nonnegative integer measurements |
| `outcome` | `success` or `failure` |
| `status_code` | Final HTTP status; 499 represents client disconnect |
| `error_category` | Fixed sanitized category or null |

There are time and model/time indexes and database constraints for durations,
tokens, outcomes, statuses and error categories. No API keys, authorization
headers, prompts, messages, replies, IP addresses or raw error text are stored.
Model names come from trusted server configuration, never request text.

Each POST to `/api/chat` is counted, including validation/rate-limit failures,
timeouts and disconnects; unrelated endpoints and OPTIONS requests are excluded.
The model field describes the configured target even when validation prevents an
upstream call. A successful response requires a 2xx HTTP completion.

Missing, negative, fractional, nonnumeric, oversized or inconsistent usage fields
are treated as unknown. Missing totals are **not inferred** from other counters.
Aggregate sums include known values only; null means no reported values.
`requestsWithTotalTokens` describes total-token coverage. Measured zero remains zero.
Average latency includes both successful and failed requests.

The pool defaults to 5 connections, a 1.5-second connection/server-statement
timeout, a 2-second client-query timeout, and 30-second idle eviction. Idle-client
errors are caught and sanitized. Failed writes are discarded, not retried. The
queue is bounded (default 500 outstanding events) and has one writer; saturation,
missing configuration, and shutdown reject new events. Its counters are visible
only in authorized analytics responses. They reset on process restart.

SIGINT/SIGTERM stop accepting HTTP requests, finish pending retention and telemetry,
and close the pool. A 15-second hard deadline prevents indefinite shutdown; pending
events may be lost at that deadline or on crashes. This is best-effort operational
telemetry, **not an audit ledger or billing source**.

### Migrations and retention

```sh
npm run db:generate --workspace backend  # after editing src/db/schema.ts
npm run db:migrate --workspace backend
npm run db:prune --workspace backend
```

Commit generated SQL and `meta` files together. Drizzle tracks applied migrations
in its migration table; SQL changes run transactionally. A PostgreSQL advisory lock
rejects competing migration runners. Failed migration sessions are destroyed to
release locks and roll back transactions. Use a privileged migration role and a
restricted application role with SELECT/INSERT/DELETE on `ai_requests` in production.
Do not give the application role schema ownership or DDL privileges.

`TELEMETRY_RETENTION_DAYS` defaults to 30 (range 1–365). Startup and a nonoverlapping
minute timer delete at most 1,000 expired rows per pass. The prune command performs
one such batch. During outages or after a large backlog, deletion is eventual;
repeat the command or schedule additional batches to catch up. This is an age limit,
not a hard row/storage cap. Size and monitor database storage for expected traffic.

For a deliberate complete telemetry reset, connect as an authorized database
operator and execute `TRUNCATE TABLE public.ai_requests;`. This irreversibly removes
operational history but leaves the schema/migration history. Stop writers first if
you need the table to remain empty. Backups/WAL have separate retention policies.
`docker compose down` retains development data; adding `--volumes` deletes it.

## Analytics authorization

Analytics is disabled by default. **Production analytics access is not implemented**:
startup rejects local analytics when `NODE_ENV=production` or `TRUST_PROXY=true`.
The backend route guard also denies those configurations independently.

To enable it on a trusted developer computer:

1. Generate a separate administrator secret: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Set `ANALYTICS_LOCAL_ENABLED=true` and `ANALYTICS_LOCAL_SECRET=<generated value>`
   in the backend `.env`. Keep `TRUST_PROXY=false` and a loopback `FRONTEND_ORIGIN`.
3. Restart the backend. It binds to **127.0.0.1** while local analytics is enabled.
4. Open **Usage analytics** below the chat and enter the administrator secret.

The secret is never compiled into frontend assets or written to browser storage.
The input is cleared on submission. Login issues an opaque random 15-minute
HttpOnly, SameSite=Strict, `/api/analytics`-scoped cookie. Sessions are hashed in
bounded server memory (maximum 32), expire, and are invalidated by logout/restart.
The browser stores only the short-lived cookie, never the permanent admin secret.
Provider keys are not administrative credentials. HTTP cookies are intentionally
for local development; do not expose this mode through a tunnel or reverse proxy.

Every analytics request requires a direct loopback socket, a loopback Host, the
exact configured Origin, and no `Forwarded`/`X-Forwarded-*` headers. Aggregate
requests also require a valid session. Analytics responses use `Cache-Control:
no-store`; CORS credentials are enabled only for analytics paths and the configured
origin. The existing API rate limiter covers login and reads. A shared/local
multiuser machine is not an isolation boundary against a privileged local user.

For production administration, add a reviewed identity/session system with admin
roles, HTTPS secure cookies and appropriate CSRF controls. Do not remove the local
guard to make the dashboard publicly reachable.

## REST API

Existing endpoints remain:

- `GET /api/health`: process liveness, independent of PostgreSQL.
- `POST /api/chat`: `{ "apiKey": "...", "messages": [{ "role": "user", "content": "..." }] }`.
  Returns `{ reply, usage, requestId }`; missing counters are omitted in this existing API.
- `POST /api/session/clear`: confirms client-side clearing; conversations are not stored on the server.

Analytics endpoints:

| Method and path | Result |
| --- | --- |
| `POST /api/analytics/session` | Strict JSON `{ "secret": "..." }`; sets local session cookie |
| `POST /api/analytics/logout` | Revokes the cookie/session, returns 204 |
| `GET /api/analytics/summary` | Total/success/failure counts, token sums, token coverage, average latency |
| `GET /api/analytics/usage` | Metrics grouped into UTC hour/day buckets |
| `GET /api/analytics/models` | Metrics grouped by configured model |
| `GET /api/analytics/errors` | Failure metrics grouped by sanitized error category |

All four GET endpoints accept strict query parameters:

| Parameter | Validation/default |
| --- | --- |
| `start`, `end` | ISO 8601 timestamps with timezone; inclusive start, exclusive end; defaults to last 7 days |
| `model` | Exact match, 1–128 characters |
| `outcome` | `success` or `failure` |
| `bucket` | `day` (default) or `hour`; applies to usage |
| `limit` | Integer 1–100, default 50; applies to grouped endpoints |
| `offset` | Integer 0–10000, default 0; applies to grouped endpoints |

Ranges must have positive duration and span at most 90 days. Unknown/duplicate or
malformed parameters are rejected. Grouped pages return
`{ data: { items, limit, offset, hasMore }, range, telemetry }`; summary returns
`{ data: { totalRequests, successfulRequests, failedRequests, promptTokens,
completionTokens, totalTokens, requestsWithTotalTokens, averageLatencyMs }, range,
telemetry }`. Time buckets are ISO UTC strings. Groups sort by time/model/category
ascending; empty time buckets are omitted. Separate requests use separate database
snapshots, so active traffic can change counts between responses/pages.

Errors: 400 invalid filters/body, 401 missing/expired session or wrong secret,
403 restricted access, 429 rate limit, 503 database disabled/unavailable. Database
errors never expose SQL, credentials, connection strings or driver messages.

The dashboard displays totals, coverage, latency, daily trends, paginated models
and error categories. Its **Through** date includes that whole UTC day. It has
loading, restricted/login, error, empty and database-unavailable states, and does
not replace or unmount chat when opened.

## Security controls

- Runtime-only provider credentials; no browser localStorage/sessionStorage.
- Strict Zod schemas reject unknown payload fields. Limits cover key shape,
  message count/content, final user role, prompt size and user turns.
- Helmet, disabled `x-powered-by`, explicit CORS allowlist, JSON body cap,
  API rate limits, request/upstream cancellation and timeouts.
- Parameterized Drizzle queries and fixed allowlisted SQL grouping expressions.
- Sanitized failures/logging; caller-controlled URL text and validation values
  are not reflected in logs or error details.
- Independent local admin secret, expiring server sessions, loopback/origin guards.
- Bounded database pool, background queue, retention batches and shutdown.

Production requires HTTPS for the frontend and correctly configured upstream and
database transport. Configure verified PostgreSQL TLS/CA settings appropriate to
your hosting environment; do not disable certificate validation. Configure
`TRUST_PROXY` only for a known trusted proxy topology. The rate limiter is local
to each process, so a distributed deployment needs a shared store.

## Configuration

See `.env.example`. Existing controls remain `NODE_ENV`, `PORT`, `FRONTEND_ORIGIN`,
`TRUST_PROXY`, `REQUEST_TIMEOUT_MS`, `UPSTREAM_TIMEOUT_MS`, `REQUEST_BODY_LIMIT`,
`MAX_PROMPT_CHARS`, `MAX_MESSAGE_CHARS`, `MAX_TURNS`, `MAX_MESSAGES`,
`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `UPSTREAM_API_URL`, and `UPSTREAM_MODEL`.
Database controls are `DATABASE_URL`, `DB_POOL_MAX` (1–20), `DB_TIMEOUT_MS`
(100–5000), `TELEMETRY_QUEUE_SIZE` (1–10000), and `TELEMETRY_RETENTION_DAYS`.
Local access uses `ANALYTICS_LOCAL_ENABLED` and `ANALYTICS_LOCAL_SECRET` (32–256 chars).

## Tests and verification

```sh
npm test
npm run build
npm audit
npm audit --omit=dev
```

Backend tests without `TEST_DATABASE_URL` explicitly skip five PostgreSQL tests.
For the real database suite, **use only a disposable test database**: tests apply
migrations, insert/delete rows and run retention. They must never target production.

```sh
docker compose --profile test up -d --wait postgres-test
export TEST_DATABASE_URL=postgresql://gateway_test:test-only-password@127.0.0.1:5433/gateway_test
npm test
npx playwright install chromium
npm run test --workspace frontend
```

PowerShell equivalent: `$env:TEST_DATABASE_URL='postgresql://gateway_test:test-only-password@127.0.0.1:5433/gateway_test'`.
The browser suite starts its own frontend (5173) and, when that variable is set,
backend (4100) with a deterministic local provider double. Keep those ports free.
It exercises real sessions, database writes, authenticated dashboard queries,
logout, clearing chat/keys and storage privacy on desktop and mobile Chromium.
Without the variable, the two live tests skip; four UI state tests still run.
Browser traces are disabled because a full live trace would contain test credentials.

The backend suite covers successful/failed/concurrent requests, missing/malformed
tokens, validation, access rejection, session expiry, outages, timeouts, queue
saturation and a worker-handoff race. PostgreSQL tests cover migrations, constraints,
aggregation/filtering, injection resistance, idempotency, retention and timeouts.
See [the engineering audit](docs/engineering-audit.md) for actual verification and limitations.

## Known limitations and deployment readiness

- Analytics is for authorized local development; production authentication is deferred.
- Telemetry is best-effort, global across this gateway, and has no tenant/user attribution.
- Retention is eventual and does not impose a hard disk or row limit.
- Separate analytics queries are not a transactionally consistent report.
- Real provider credentials, hosted database TLS, production load/failover and Docker
  itself require deployment-environment verification. Test provider responses are deterministic.
- Only Chromium desktop/mobile emulation is covered; other browsers are unverified.
- Multi-provider routing, streaming, distributed rate limiting and a durable event queue
  are not implemented.

The lockfile includes security updates. Targeted overrides keep `qs` and development
esbuild dependencies outside audited vulnerable ranges; recheck them when upgrading
Express, tsx or Drizzle tooling. Migration generation, builds and tests must be rerun.
