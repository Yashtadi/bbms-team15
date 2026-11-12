# BBMS operations and availability plan (NF-002)

**Requirement (SRS §5, BBMS-NF-002):** the system provides **99.5% availability per month**, excluding scheduled maintenance.

This can't be measured during a two-week student project, because we don't run a production deployment for a month. This document records how the system *would* meet and measure the target, and what is already built into the code to support it. The deviation is logged in [`DEVIATIONS.md`](../DEVIATIONS.md).

---

## 1. What 99.5% means

| Period | Allowed unplanned downtime |
|---|---|
| Month (30.44 days, 43,830 min) | **≈ 219 minutes (3 h 39 min)** |
| Week | ≈ 50 minutes |
| Day | ≈ 7 minutes |

Monthly availability = `(minutes in month − scheduled maintenance − unplanned downtime) / (minutes in month − scheduled maintenance) × 100`.

The 219-minute **error budget** is consumed by unplanned outages only. When more than half of it is spent in a month, non-urgent deploys stop until the cause is fixed.

---

## 2. What is in the code

| Feature | Where | Why it helps availability |
|---|---|---|
| `GET /api/health` → `{ status: 'ok' }` | `server/src/modules/health/health.routes.js` | Original simple check, kept for existing scripts. |
| `GET /api/health/live` → `{ status, uptimeSeconds, timestamp }` | same | **Liveness.** Never touches the database, so a database outage does not make the process manager restart a healthy Node process. |
| `GET /api/health/ready` → 200 `{ status: 'ok', checks: { server, database, databaseLatencyMs } }` or **503** `{ status: 'unavailable', … }` | `health.service.js` | **Readiness.** Runs `SELECT 1` with a 2 s timeout. 503 tells the load balancer and the uptime monitor that the API can't do real work. Error details are never returned. |
| Graceful shutdown on `SIGTERM` / `SIGINT` | `server/src/lifecycle.js` | On a deploy or restart: readiness turns 503 first, open requests finish, the DB pool closes, then the process exits (forced after 10 s). Deploys don't cut requests off halfway. |
| Unhandled promise rejections are logged | `server/src/lifecycle.js` | Problems outside a request show up in the logs instead of going unnoticed. |
| DB pool: `waitForConnections`, `connectTimeout: 10000`, `enableKeepAlive` | `server/src/db.js` | Bursts queue instead of failing; an unreachable DB fails fast; idle connections are not silently dropped by firewalls. |
| Slow-request log and `Server-Timing` header | `server/src/middleware/response.time.js` (NF-001) | Slow responses are visible before they turn into timeouts. |
| `Cache-Control: no-store` on health routes | `health.routes.js` | A proxy can never serve a cached "ok" during an outage. |

Health routes are public (no token), like the original `/api/health`, so external monitors can call them. They return no personal or configuration data.

---

## 3. Intended hosting

```
Users ──HTTPS (TLS 1.2+)──▶ Reverse proxy / load balancer ──▶ Node API ×2 ──▶ Managed MySQL 8
                            (TLS termination, health checks       (process manager      (automated daily
                             on /api/health/ready)                 or containers with    backups, point-in-
                                                                   restart policy)       time recovery)
```

1. **Two API instances** behind the load balancer (PM2 cluster mode, or two containers with `restart: unless-stopped`). One instance can crash or be redeployed while the other keeps serving. Rolling deploys replace one instance at a time.
2. **Load balancer health check:** `GET /api/health/ready` every 10 s; take an instance out after 2 failures, put it back after 2 successes.
3. **Process manager / container liveness:** `GET /api/health/live`; restart the process if it stops answering.
4. **Managed MySQL** with automated daily backups, 7-day point-in-time recovery, and a standby replica if the budget allows. The database is the main single point of failure.
5. **TLS** terminated at the proxy, as required by SR-001 (`X-Forwarded-Proto: https` is trusted from the proxy).
6. `NODE_ENV=production` so HTTPS is enforced.

---

## 4. Monitoring and alerting

| What | How | Alert |
|---|---|---|
| External uptime | An uptime monitor (e.g. UptimeRobot or Better Stack) polls `https://<host>/api/health/ready` every **1 minute** from at least two regions | Page the on-call team member after **2 consecutive failures** |
| Availability report | The same monitor's monthly uptime report, with maintenance windows marked | Reviewed at the start of each month against the 99.5% target |
| Slow requests | `[NF-001] Slow request` lines in the API logs | Investigate if more than 5 in 10 minutes |
| Crashes / restarts | Process manager or container restart count | Investigate any restart loop |
| Database | Managed DB metrics: connections, CPU, storage, replication lag | Alert at 80% of any limit |

---

## 5. Scheduled maintenance (excluded from the target)

- **Window:** Sunday 02:00–04:00 IST, the lowest-traffic period for a blood bank's routine work.
- Announced to hospital users **at least 48 hours** in advance.
- Marked as maintenance in the uptime monitor so it is excluded from the availability figure.
- Emergency issuance has a paper fallback during maintenance (manual register, entered afterwards).
- Schema changes (`server/db/schema.sql`) are applied only in this window, after a fresh backup.

---

## 6. Incident response

1. **Detect:** the uptime monitor alerts (2 failed readiness checks).
2. **Check:** `GET /api/health/live` and `GET /api/health/ready`.
   - Live OK but ready 503 with `database: 'down'` → database or network problem: check the managed DB console and connection limits.
   - Live failing → API process problem: check the process manager or container logs and restart counts.
3. **Restore:** restart or roll back the last deploy (one instance at a time); if the database is lost, restore from the latest backup or point-in-time recovery.
4. **Record:** start time, end time, minutes of downtime, cause, and the fix. Subtract the downtime from the month's error budget.
5. **Follow up:** a short blameless review for any incident longer than 15 minutes.

---

## 7. Verifying the pieces locally

```bash
cd server && npm run dev
curl -i http://localhost:4000/api/health/live    # 200
curl -i http://localhost:4000/api/health/ready   # 200 with MySQL running
# Stop the MySQL service, then:
curl -i http://localhost:4000/api/health/ready   # 503 { status: 'unavailable', checks: { database: 'down' } }
# Press Ctrl+C in the server terminal: the log shows "[NF-002] SIGINT received: draining connections"
```

Automated tests: `tests/unit/health.service.test.js`, `tests/unit/health.routes.test.js`, `tests/unit/lifecycle.test.js` and `tests/integration/health.test.js` (TC-Ops-01, TC-Ops-02).
