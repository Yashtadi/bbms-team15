# Blood Bank Management System (BBMS) — Project Guide

This guide describes the implemented Team 15 BBMS student project: its users,
workflows, architecture, API, local setup, security controls, tests, and known
limitations. It complements the [README](../README.md), [requirements
traceability matrix](RTM.md), [test summary](TEST-SUMMARY.md),
[operations plan](OPERATIONS.md), [deviation log](../DEVIATIONS.md), and
[contribution guide](../CONTRIBUTING.md).

## 1. Project at a glance

BBMS is a web application for coordinating blood donation collection,
laboratory screening, inventory, and hospital blood requests. It tracks blood
units from donation through screening and storage to reservation and issue.
The application is a software engineering mini project and demo; it is not a
substitute for clinical judgment, validated blood-bank software, or local
transfusion regulations.

| Layer | Technology | Location |
|---|---|---|
| Web client | React, Vite, JavaScript | `client/` |
| API | Node.js, Express | `server/src/` |
| Database | MySQL 8+, `mysql2` promise pool | `server/db/`, `server/src/db.js` |
| Client tests | Vitest, React Testing Library, jsdom | `client/src/**/*.test.jsx` |
| Server tests | Jest, Supertest | `server/tests/` |
| CI | GitHub Actions | `.github/workflows/ci.yml` |

### Key capabilities

- Role-based authentication and user sessions, with TOTP multi-factor
  authentication for administrators and managers.
- Donor registration, consent, eligibility checks, donor IDs, and a donor
  self-service history/card.
- Donation sessions, pre/post donation vitals, barcode labels, and offline
  outreach-camp record synchronization.
- FIFO lab queue, dual-entry ABO/Rh verification, required infectious-disease
  screening, quarantine release, and reactive-result handling.
- Inventory summary, component separation and lineage, FEFO suggestions,
  expiry/low-stock alerts, and temporary unit reservations.
- Hospital requests, emergency prioritization, cross-matching, issuance, and
  custody/audit records.
- Health/readiness endpoints, request timing, and graceful API shutdown.

## 2. Roles and access

The client shows different workspaces by role. API authorization is enforced
on the server as well; hiding a tab is not the security boundary.

| Role | Intended use |
|---|---|
| `DONOR` | View the authenticated donor's card, profile, and donation history. |
| `LAB_TECH` | Register donors, assess eligibility, record collections/vitals,
  perform laboratory screening, manage units, and process requests. |
| `MANAGER` | Oversee inventory and request operations; privileged login
  requires MFA. |
| `HOSPITAL` | Create and track requests for the hospital associated with the
  account; view matching, reservations, and issue history for its requests. |
| `ADMIN` | Administrative and operational access across the application;
  privileged login requires MFA. |

The collection desk is for the collector persona (a `LAB_TECH` account
identified in the demo by `collector@bbms.test`) and administrators. Other
`LAB_TECH` accounts use the lab/inventory/request workspaces as permitted.
Actual route-level permissions are the source of truth.

### Seeded demo accounts

`npm run db:setup` loads fictional seed data. These demo accounts share the
seed password `Password@123`. Use them only with a disposable local demo
database; change or remove them before any deployment.

| Email | Role | Workspace |
|---|---|---|
| `collector@bbms.test` | `LAB_TECH` | Collection desk and label tool |
| `labtech@bbms.test` | `LAB_TECH` | Lab, inventory, and request workflows |
| `labtech2@bbms.test` | `LAB_TECH` | Second technician for two-person ABO/Rh verification |
| `manager@bbms.test` | `MANAGER` | Inventory and operational oversight |
| `hospital@bbms.test` | `HOSPITAL` | Hospital blood requests |
| `donor@bbms.test` | `DONOR` | Donor portal for the seeded donor |
| `admin@bbms.test` | `ADMIN` | Administrative access |

Admin and manager demo logins may require completing MFA enrollment and
verification. Do not copy seed credentials into a production environment.

## 3. Main workflows

### 3.1 Donor registration and collection

1. Staff find an existing donor by donor code/phone or register a walk-in
   donor. A donor code is generated in the form `D-XXXXXX`.
2. Record informed consent and evaluate eligibility. The implementation uses
   the configured project rules, including age 18–65, minimum weight 45 kg,
   haemoglobin at least 12.5 g/dL, and a 90-day whole-blood donation interval.
3. Staff start a collection session and capture collection details and vitals.
   Readings outside the project's warning ranges may be stored with warnings;
   impossible or invalid values are rejected. See [DEVIATIONS.md](../DEVIATIONS.md)
   for assumed ranges and other decisions that require team/clinical review.
4. The system creates a quarantined unit with a unit barcode such as
   `U-YYYY-XXXXXX`. Labels can be printed from the browser; this project does
   not include a physical printer/scanner integration.
5. Post-donation vitals can be recorded against the donation session.

The collection desk also supports recording outreach-camp collections while
offline and synchronizing them later. Client-generated references make
re-synchronization idempotent.

### 3.2 Laboratory screening and quarantine

1. Lab staff work from a FIFO queue of units awaiting tests.
2. A technician records ABO/Rh. A different technician must verify the same
   result.
3. Required TTI results are recorded for HIV, HBV, HCV, syphilis, and malaria.
4. The unit remains quarantined until ABO/Rh verification and all required TTI
   results pass. A reactive result causes affected units to be discarded and
   creates confidential staff notifications.
5. Eligible whole-blood units can be separated into components. Parent/child
   lineage remains queryable.

### 3.3 Inventory

Inventory screens show stock available for use, with filtering and summary
counts. Allocation suggestions use FEFO (first-expiring, first-out) and
blood-component compatibility rules. Staff can review expiry and low-stock
alerts. Temporary reservations are removed from available stock and expire
after their configured hold period.

Supported components are `WHOLE_BLOOD`, `PRBC`, `FFP`, `PLATELETS`, and
`CRYO`; blood groups are `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, and `O-`.
Shelf-life and component-separation assumptions are recorded in the source
and deviation log; verify clinical/local policy before real use.

### 3.4 Hospital requests, cross-match, and issue

1. Hospital staff create a request with patient details, blood group (which may
   be unknown), component, requested quantity, urgency, and optional required
   time. Requests receive codes such as `R-XXXXXX`.
2. Emergency requests are prioritized in the queue. Staff review FEFO
   suggestions and record a cross-match for a candidate unit.
3. Only a compatible cross-match can proceed to reservation/issuance.
   Reservations have a finite hold duration, can be released early, and
   automatically return to stock when they expire.
4. For an emergency PRBC request with unknown patient blood group, O-negative
   fallback suggestions are allowed. A compatible cross-match is still
   mandatory. The fallback is not used for other unknown-group request types.
5. Issuance updates request/unit state and records a custody entry linking the
   unit, request, cross-match, staff member, time, and recipient. The issuance
   transaction prevents over-allocation when multiple units are held/issued.

## 4. Architecture and data model

The Vite client calls the Express API using `/api` routes. During local
development Vite proxies these requests to `http://localhost:4000`. The API is
organized into route, service, and repository layers. Repositories share a
MySQL connection pool. Related inventory, reservation, and issuance changes
use transactions and row locks where needed to preserve consistency.

```text
Browser (React/Vite :5173)
        │ /api (Vite development proxy)
        ▼
Express API (:4000)
  ├─ auth       ├─ donors       ├─ collection
  ├─ lab        ├─ inventory    ├─ requests
  └─ health
        │
        ▼
MySQL database (bbms)
```

| Table | Purpose |
|---|---|
| `users` | Login identities, roles, password hashes, and MFA state. |
| `donors` | Donor demographic/contact records, eligibility, consent, and
  donor code. |
| `donations` | Collection sessions, staff, donation type, and pre/post vitals. |
| `blood_units` | Individual bags/components, status, expiry, reservations,
  barcode, and parent-child lineage. |
| `lab_results` | ABO/Rh and TTI results, including the second-person
  verification state. |
| `blood_requests` | Hospital request details, urgency, quantities, and status. |
| `crossmatches` | Unit/request compatibility test records. |
| `issuances` | Unit issue and custody details. |
| `audit_log` | Append-only application audit events. |
| `notifications` | Confidential staff notifications, including reactive TTI
  alerts. |

The schema and seed files are in [`server/db/`](../server/db/). The setup
script runs both SQL files; the schema explicitly drops/recreates the tables.

## 5. Local development setup

### Prerequisites

- Node.js and npm versions supported by the installed project dependencies.
- MySQL 8+ available locally.
- Git.

### Configure and start

1. Create `server/.env` by copying `server/.env.example`. Set the MySQL
   connection values and replace the example `JWT_SECRET` and
   `ENCRYPTION_KEY` with private, sufficiently strong values. Never commit
   `server/.env`.
2. From the repository root, initialize the disposable development database
   and start the API:

   ```sh
   cd server
   npm install
   npm run db:setup
   npm run dev
   ```

   The API listens on `http://localhost:4000` by default.
3. In a separate terminal, install and start the client:

   ```sh
   cd client
   npm install
   npm run dev
   ```

4. Open `http://localhost:5173`.

The following server environment variables are used by the example
configuration:

| Variable | Purpose | Example/default |
|---|---|---|
| `PORT` | HTTP API port | `4000` |
| `DB_HOST`, `DB_PORT` | MySQL host and port | `127.0.0.1`, `3306` |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL credentials and schema | User-defined; database `bbms` |
| `JWT_SECRET` | Signs authentication tokens | Replace the example |
| `ENCRYPTION_KEY` | Encrypts sensitive stored values | Replace with a private key |
| `RESERVATION_HOLD_MINUTES` | Default unit reservation duration | `120` |
| `SLOW_REQUEST_MS` | Slow API request logging threshold | `2000` ms |
| `USE_HTTPS`, `HTTPS_PORT` | Optional direct HTTPS server | Disabled unless configured |
| `SSL_KEY_PATH`, `SSL_CERT_PATH` or `SSL_KEY`, `SSL_CERT` | HTTPS key/certificate inputs | Configure only for HTTPS |

`npm run db:setup` is destructive: it recreates the schema and reloads fictional
seed data. **Do not run it against a database containing data you need.**

## 6. API reference

All endpoints are under `/api`. Protected routes require a bearer token from
login; route authorization additionally checks the role. This is a route
catalog, not a complete payload/schema specification. The route files under
`server/src/modules/` and service validation define the exact request fields
and response formats.

### Authentication and health

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | First-factor login; privileged accounts may receive an MFA challenge instead of a full session. |
| `POST` | `/api/auth/mfa/setup` | Begin TOTP enrollment for a privileged account. |
| `POST` | `/api/auth/mfa/setup/verify` | Verify enrollment and enable MFA. |
| `POST` | `/api/auth/mfa/verify` | Complete the login MFA challenge. |
| `POST` | `/api/auth/change-password` | Change password for the authenticated user. |
| `GET` | `/api/health`, `/api/health/live`, `/api/health/ready` | Basic, liveness, and dependency-readiness checks. |
| `GET` | `/api/security/tls-policy`, `/api/health/tls` | Report the configured TLS policy. |

### Donor and collection

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/donors` | Register a donor. |
| `POST` | `/api/donors/:id/consent` | Record donor consent. |
| `POST` | `/api/donors/:id/eligibility`, `/api/donors/eligibility` | Evaluate a donor or supplied screening data. |
| `GET` | `/api/donors/portal/me` | Retrieve the logged-in donor's portal information. |
| `GET` | `/api/donors/:query` | Look up donor by supported code/identifier/phone. |
| `POST` | `/api/donations` | Start a collection session and create a quarantined unit. |
| `PUT` | `/api/donations/:id/vitals/pre`, `/api/donations/:id/vitals/post` | Record donation vitals. |
| `POST` | `/api/donations/sync` | Synchronize outreach-camp collection records. |
| `GET` | `/api/donations/units/:unitId` | Look up a unit barcode. |

### Laboratory and inventory

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/lab/queue` | Load FIFO testing queue and storage information. |
| `POST` | `/api/lab/donations/:id/blood-group` | Record ABO/Rh result. |
| `POST` | `/api/lab/donations/:id/blood-group/verify` | Verify ABO/Rh as a second technician. |
| `POST` | `/api/lab/donations/:id/tti-results` | Record a required TTI result. |
| `GET` | `/api/lab/notifications` | Read staff notifications for the authenticated user. |
| `GET` | `/api/inventory`, `/api/inventory/summary` | Query available units and stock summary. |
| `GET` | `/api/inventory/fefo` | Suggest FEFO-compatible stock. |
| `GET` | `/api/inventory/alerts/expiry`, `/api/inventory/alerts/low-stock` | Retrieve stock alerts. |
| `POST` | `/api/inventory/units/:unitCode/separate` | Separate an eligible whole-blood unit into components. |
| `GET` | `/api/inventory/units/:unitCode/lineage` | Retrieve parent/child component lineage. |

### Hospital requests

| Method | Path | Purpose |
|---|---|---|
| `POST`, `GET` | `/api/blood-requests` | Create a request or list accessible requests. |
| `GET` | `/api/blood-requests/:idOrCode` | Retrieve request details by ID or request code. |
| `GET` | `/api/blood-requests/:idOrCode/fefo-suggestions` | Suggest compatible units by FEFO. |
| `POST` | `/api/blood-requests/:idOrCode/crossmatch` | Record unit cross-match. |
| `GET` | `/api/blood-requests/:idOrCode/crossmatches` | Read cross-match history. |
| `GET` | `/api/blood-requests/:idOrCode/crossmatch/:unitCode/check` | Check whether a unit is ready for issuance. |
| `POST`, `GET` | `/api/blood-requests/:idOrCode/reservations` | Reserve a compatible unit or list active holds. |
| `DELETE` | `/api/blood-requests/:idOrCode/reservations/:unitCode` | Release a hold. |
| `POST`, `GET` | `/api/blood-requests/:idOrCode/issuances` | Issue a unit or read custody history. |

## 7. Security, privacy, and operations

- Passwords are stored as bcrypt hashes. Authentication uses signed JWTs and
  role checks.
- Administrator and manager accounts use TOTP MFA. Failed MFA attempts are
  tracked persistently; five invalid attempts trigger a 15-minute lockout.
- Sensitive donor fields and MFA secrets are encrypted at rest using
  authenticated encryption. Keep the encryption key private and backed up
  separately from the database.
- API requests use parameterized database queries. Inventory issuance and
  reservation updates use transactions/locking to prevent conflicting
  allocations.
- Audit entries capture operational actions; issuance records preserve
  custody links. Reactive-result notifications are restricted to their staff
  recipients.
- Do not use real patient or donor data in the demo. Use HTTPS, production
  secrets, managed database backups, monitoring, and access controls before
  any deployment. The [operations plan](OPERATIONS.md) describes the intended
  availability and hosting approach; it is not evidence that a production
  service has been deployed or has achieved the 99.5% target.
- The eligibility and vitals thresholds, component shelf lives, and fallback
  rules are project assumptions. Review [DEVIATIONS.md](../DEVIATIONS.md) and
  validate against clinical and regulatory requirements before real-world use.

## 8. Testing and verification

From `server/`:

```sh
npm test
npm run test:unit
npm run test:integration
```

Integration tests use MySQL and require a configured disposable test database.
From `client/`:

```sh
npm test
npm run build
npm run lint
```

The latest CI run on the documented project branch completed successfully for
server tests (unit and MySQL-backed integration) and client tests/build:
[GitHub Actions run 78](https://github.com/Yashtadi/bbms-team15/actions/runs/43261483473).
The broader client lint command has previously reported errors; see
[TEST-SUMMARY.md](TEST-SUMMARY.md) for the recorded test results and lint
status.

## 9. Project documentation and demo

- [README](../README.md): repository overview and quick start.
- [Requirements traceability matrix](RTM.md): Sprint 2 requirements,
  implementation locations, and verification.
- [Test summary](TEST-SUMMARY.md): recorded test/build/lint results.
- [Operations plan](OPERATIONS.md): health checks, availability target, and
  operational procedures.
- [Deviation log](../DEVIATIONS.md): implementation assumptions and
  differences from submitted specifications.
- [Contribution guide](../CONTRIBUTING.md): development and testing workflow.
- [Sprint 1 demo](Sprint-1_Demo.mp4): existing end-to-end recording.

The Sprint 2 final demo video is still to be recorded and added by the team.
