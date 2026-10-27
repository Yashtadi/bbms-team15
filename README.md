# Blood Bank Management System (BBMS) – Team 15
![CI](https://github.com/Yashtadi/bbms-team15/actions/workflows/ci.yml/badge.svg)

Software Engineering mini project, PES University.

**Team:** Vedant Sharma (Team Lead) · Yash Tadi (Dev Lead) · V. Kushal (QA Lead) · Yadunandana Reddy M (Test Engineer)

**Stack:** React (Vite) · Node.js + Express · MySQL

## Running tests

### Server (Jest + Supertest)

```bash
cd server
npm test                   # all server tests
npm run test:unit          # only tests/unit
npm run test:integration   # only tests/integration
```

Integration tests need MySQL running, a filled-in `server/.env`, and the database created with
`npm run db:setup`.

### Client (Vitest + React Testing Library)

```bash
cd client
npm test                   # run all client tests once
npm run test:watch         # re-run tests every time you save a file
```

### Unit vs integration

| Type | Where | What it tests |
|---|---|---|
| **Unit** | `server/tests/unit/` | One function or middleware on its own. No web server, no database. |
| **Integration** | `server/tests/integration/` | Real HTTP requests through the Express app (via Supertest), and/or the real MySQL database. |
| **Client** | `client/src/**/*.test.jsx` | React components rendered in a simulated browser (jsdom), next to the component they test. |

See [CONTRIBUTING.md](CONTRIBUTING.md#6-writing-tests) for how to write tests.

## Lab screening and inventory

The lab API requires a `LAB_TECH` token to record test results:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/lab/donations/:id/blood-group` | Enter `aboGroup` (`A`, `B`, `AB`, `O`) and `rh` (`+`, `-`) |
| `POST` | `/api/lab/donations/:id/blood-group/verify` | A different technician verifies the same ABO/Rh values |
| `POST` | `/api/lab/donations/:id/tti-results` | Record `testType`, `result`, and `method` (`NAT` or `ELISA`) |
| `GET` | `/api/lab/notifications` | Read confidential notifications addressed to the logged-in staff member |
| `GET` | `/api/inventory` | List unexpired, fully screened `AVAILABLE` units |

TTI `testType` values are `HIV`, `HBV`, `HCV`, `SYPHILIS`, and `MALARIA`; `result` is
`REACTIVE` or `NON_REACTIVE`. Units stay quarantined until the ABO/Rh result is verified
and all five TTI results are non-reactive. A reactive result discards all units from the
donation and creates confidential staff notifications.
