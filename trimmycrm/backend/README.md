# TrimmyCRM backend

Production-oriented multi-tenant backend for TrimmyCRM, implemented with FastAPI,
SQLAlchemy 2, PostgreSQL RLS, Redis, Celery and S3-compatible object storage.

## Runtime architecture

- one stateless FastAPI application serves every salon;
- the normalized request `Host` is resolved to `tenant_id` and cached in Redis;
- every tenant transaction sets transaction-local `app.current_tenant`;
- PostgreSQL has `ENABLE/FORCE ROW LEVEL SECURITY` on tenant tables;
- platform and tenant authentication use different JWT secrets/audiences;
- refresh tokens are rotating httpOnly cookies with CSRF protection and family
  revocation on reuse;
- Celery handles email, SMS, Telegram, reminders, subscription lifecycle and
  cleanup;
- media is scanned through ClamAV and kept in a private external S3 bucket; public
  objects are streamed through an authorization-aware API endpoint.

The API prefix is `/api/v1`; OpenAPI is available at `/api/docs` when exposed by
the deployment configuration.

## Local start

The complete stack is owned by `../deploy/infra`:

```bash
cd ../deploy/infra
cp dev.env.example .env
docker compose --env-file .env config --quiet
docker compose --env-file .env up --build -d --wait
```

Use `http://trimmycrm.localhost:8080` for the platform and
`http://<slug>.trimmycrm.localhost:8080` for a salon. Only Caddy publishes host
ports; PostgreSQL, Redis and Nginx remain internal. Media is stored in the
external S3 bucket configured through `S3_*` variables.

## Development commands

Python 3.12 is required.

```bash
python -m pip install -e '.[dev]'
make lint
make typecheck
make test
alembic upgrade head
uvicorn app.main:app --reload
```

Required secrets and service URLs are defined in `app/core/config.py` and in the
deployment env examples. The process intentionally fails at startup when
cryptographic keys, production captcha, payment credentials or fail-closed
malware scanning are missing.

## Database roles

- `trimmycrm_admin` owns schema objects and runs Alembic only;
- `trimmycrm_app` is the tenant runtime role and is `NOBYPASSRLS`;
- `trimmycrm_admin_api` is also `NOBYPASSRLS` and is used only by explicitly
  cross-tenant operations such as superadmin, verified webhooks and workers.

RLS context is set with `set_config(..., true)` inside the same function-scoped
transaction as the business query, so pooled connections cannot leak tenant
state.

## First superadmin bootstrap

Create the first platform superadmin from inside the API container. The command
validates the email and the configured password policy, then creates an active,
email-verified account through `AdminSession` with the platform RLS scope:

```bash
cd ../deploy/infra
docker compose --env-file .env exec api \
  python -m app.bootstrap_superadmin admin@example.com
```

The password is requested twice through a non-echoing terminal prompt. For
automation, pass it through stdin from a protected file or secret store; never
put it in a command-line argument or an environment variable:

```bash
docker compose --env-file .env exec -T api \
  python -m app.bootstrap_superadmin admin@example.com --password-stdin \
  < /secure/path/superadmin-password
```

Re-running the command for the same superadmin is a no-op and does not reset the
password or account status. It refuses to promote an existing owner/staff and
refuses to create a different account after the first superadmin exists.

## Tests and operations

Unit tests cover scheduling, tariff-aware site snapshots, safe public DTOs,
site-block and URL validation, and media validation. The `tests/load/k6.js`
scenario is read-only. Its default `smoke` profile sends two virtual users for
30 seconds to `/healthz` and `/api/v1/plans`; configure a tenant host and paths
to test public salon endpoints:

```bash
k6 run -e BASE_URL=https://platform.example \
  -e TENANT_HOST=salon.platform.example \
  -e PATHS=/api/v1/public/site,/api/v1/public/services tests/load/k6.js
```

The stronger ramp profile is deliberately opt-in (`LOAD_PROFILE=load`) and its
concurrency/duration are configured with `LOAD_VUS` and `HOLD_DURATION`. Run it
against production only in an approved window while infrastructure metrics are
being observed. Container health endpoints are `/health/live` and
`/health/ready`; Prometheus metrics are served internally at `/metrics`.

Production deployment must run in a Russian data region for the stated 152-FZ
requirements, use encrypted off-host backups, provision the wildcard
certificate described in `deploy/infra/README.md`, and keep all `.env` and
`deploy/infra/secrets` files outside version control.
