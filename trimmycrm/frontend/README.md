# TrimmyCRM frontend

Next.js App Router frontend for the TrimmyCRM platform and tenant websites.

```bash
npm install
npm run dev
```

The browser uses the same-origin `/api/v1` API path. In the Docker deployment,
Nginx routes that prefix to FastAPI and all page requests to this application.

## Tests

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

The Playwright smoke test for a remote environment has no data mutations. It is
intentionally disabled by default and requires both variables below:

```bash
LIVE_E2E=1 E2E_BASE_URL=https://example.com npm run test:e2e -- tests/live-production-smoke.e2e.ts
```

The authenticated check covers CRM navigation, refresh-cookie recovery, the
read-only tariff dialog, a tenant client account, and slot lookup without
creating appointments or payments. Credentials are read only from the process
environment and must never be put in a test file or committed `.env` file:

```bash
LIVE_E2E=1 E2E_BASE_URL=https://platform.example.com E2E_TENANT_BASE_URL=https://salon.platform.example.com LIVE_PLATFORM_EMAIL=owner@example.com LIVE_PLATFORM_PASSWORD='…' npm run test:e2e -- tests/live-authenticated.e2e.ts
```
