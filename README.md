# Blood Bank Management System (BBMS) – Team 15
![CI](https://github.com/Yashtadi/bbms-team15/actions/workflows/ci.yml/badge.svg)

Software Engineering mini project, PES University.

**Team:** Vedant Sharma (Team Lead) · Yash Tadi (Dev Lead) · V. Kushal (QA Lead) · Yadunandana Reddy M (Test Engineer)

**Stack:** React (Vite) · Node.js + Express · MySQL

---

## Sprint 1 Demo Video

A screen recording demonstrating the complete end-to-end clinical workflow implemented in Sprint 1:
> **Register Donor** (`F-001`, `F-003`, `F-004`) → **Eligibility Check** (`F-002`) → **Donation Session & Vitals** (`F-010`, `F-011`) → **Barcode Unit Label** (`F-012`) → **Lab Screening (ABO/Rh & TTI)** (`F-020`, `F-021`) → **Quarantine Release / Discard** (`F-022`, `F-023`).

- 📹 **Watch Video:** [docs/Sprint-1_Demo.mp4](docs/Sprint-1_Demo.mp4)

---

## Quick Start (Running Locally)

### 1. Database & Server Setup
```bash
cd server
npm install
# Ensure MySQL is running and server/.env is configured
npm run db:setup     # creates database, runs schema.sql and seed.sql
npm start            # runs backend on http://localhost:5000
```

### 2. Client Setup
```bash
cd client
npm install
npm run dev          # runs frontend on http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Demo Accounts & User Roles

All pre-seeded demo accounts use the default password: `Password@123` (populated via `npm run db:setup`).

| Role | Demo Email | Display Name | Target Operating Group & Capabilities |
|---|---|---|---|
| `LAB_TECH` | `collector@bbms.test` | **Blood Collector** | **Frontline Blood Collection Desk:** Operates the 3-step Blood Collection Desk (walk-in donor check-in, registration, chair-side vitals, session recording, Code 128 barcode stickers) and Blood Label Tool |
| `LAB_TECH` | `labtech@bbms.test`<br>`labtech2@bbms.test` | **Labtech 1**<br>**Labtech 2** | **Central Facility (Testing Lab):** Operates the Lab Screening workspace (FIFO testing queue, dual ABO/Rh verification, 5 mandatory TTI tests), and manages quarantine stock |
| `HOSPITAL` | `hospital@bbms.test` | **City Hospital Desk** | **Hospital Clinical Desk:** Submits and tracks hospital patient blood unit requests |
| `MANAGER` | `manager@bbms.test` | **Manoj Manager** | **Central Facility (Storage Manager):** Central storage & inventory oversight, stock levels by blood group and component, expiry monitoring, and unit barcode reprint tool |
| `DONOR` | `donor@bbms.test` | **Ravi Kumar** | **Donor Portal:** View digital donor card and donation history (linked to pre-seeded donor `D-000001` / Ravi Kumar) |
| `ADMIN` | `admin@bbms.test` | **Asha Admin** | **System Administrator:** Full administrative and operational oversight across all facility and frontline workspaces |

> **Walk-in Donors & Self-Service Portal:**  
> When a walk-in donor is registered at the collection desk, the system automatically creates their permanent **Donor ID** (e.g. `D-000006`), generates a printable CR80 physical identification card, and provisions their web portal account with a default password syntax `DDMMYYYY` (derived from their Date of Birth). Donors can sign in from home using their Donor ID or Email, download their digital card as a high-resolution PNG, view their lifetime donation stats, check their next eligible donation date, and securely change their password.
>
> **Patient Blood Requests:**  
> Patients do not log in directly. Hospital personnel log in via `hospital@bbms.test` to submit and manage blood unit requests on a patient's behalf.

---

## Sprint 1 Features Implemented

| ID | Feature | Description |
|---|---|---|
| **F-001** | Donor Registration | Demographic details, contact, ID proof, medical history |
| **F-002** | Donor Eligibility Check | Rule-based screening: age (18–65), weight (≥45 kg), Hb (≥12.5 g/dL), 90-day donation interval |
| **F-003** | Donor ID Generation | Atomically generated, sequential human-readable identifier (`D-XXXXXX`) |
| **F-004** | Digital Donor Consent | Explicit consent verification before donation session |
| **SR-002** | Role-Based Authentication | Secure JWT auth with bcrypt passwords & strict role authorization |
| **F-010** | Donation Session | Whole blood & apheresis session recording |
| **F-011** | Donor Vitals Recording | Pre- and post-donation BP, pulse, and hemoglobin with clinical safe range alerts |
| **F-012** | Unit Barcode Label | Printable Code 128 barcode unit label and keyboard/scanner lookup |
| **F-020** | Dual ABO/Rh Verification | Blind double-entry verification of blood group prior to inventory release |
| **F-021** | TTI Screening | Mandatory screening for 5 infectious markers (HIV, HBV, HCV, Syphilis, Malaria) |
| **F-022** | Quarantine State Lock | Units remain locked in `QUARANTINE` until all verification steps pass |
| **F-023** | Auto-Discard Reactive Units | Automatic disposal of reactive units and confidential staff alert logging |

---

## Running tests

### Server (Jest + Supertest)

```bash
cd server
npm test                   # all server tests
npm run test:unit          # only tests/unit
npm run test:integration   # only tests/integration
```

Integration tests need MySQL running, a filled-in `server/.env`, and the database created with `npm run db:setup`.

**Performance (TC-Perf-01, NF-001):** `tests/integration/performance.test.js` loads about 1,200 extra units,
300 donors and 300 requests, sends 100 requests (10 at a time) to each search and inventory endpoint, and fails if
any endpoint's 95th-percentile response time reaches 2 seconds. It prints a p50/p95/max table and deletes its data
afterwards. Every API response also carries a `Server-Timing: app;dur=<ms>` header, and requests slower than
`SLOW_REQUEST_MS` (default 2000) are logged as `[NF-001] Slow request`.

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

---

## Lab screening and inventory API

The lab API requires a `LAB_TECH`, `MANAGER`, or `ADMIN` token:

| Method | Path | Allowed Roles | Purpose |
|---|---|---|---|
| `GET` | `/api/lab/queue` | `LAB_TECH`, `MANAGER`, `ADMIN` | Retrieve FIFO quarantine testing queue and central facility storage units |
| `POST` | `/api/lab/donations/:id/blood-group` | `LAB_TECH`, `ADMIN` | Enter `aboGroup` (`A`, `B`, `AB`, `O`) and `rh` (`+`, `-`) |
| `POST` | `/api/lab/donations/:id/blood-group/verify` | `LAB_TECH`, `ADMIN` | A different technician verifies the same ABO/Rh values |
| `POST` | `/api/lab/donations/:id/tti-results` | `LAB_TECH`, `ADMIN` | Record `testType`, `result`, and `method` (`NAT` or `ELISA`) |
| `GET` | `/api/lab/notifications` | `LAB_TECH`, `MANAGER`, `ADMIN` | Read confidential notifications addressed to the logged-in staff member |
| `GET` | `/api/inventory` | `LAB_TECH`, `MANAGER`, `ADMIN` | List unexpired, fully screened `AVAILABLE` units |
| `GET` | `/api/inventory/summary` | `LAB_TECH`, `MANAGER`, `ADMIN` | Stock summary metrics and blood group × component grid |
| `POST` | `/api/inventory/units/:unitCode/separate` | `LAB_TECH`, `MANAGER`, `ADMIN` | Separate a whole-blood unit into `components` (`PRBC`, `FFP`, `PLATELETS`, `CRYO`); returns the parent and the new component units (F-031) |
| `GET` | `/api/inventory/units/:unitCode/lineage` | `LAB_TECH`, `MANAGER`, `ADMIN` | A unit's parent, components, sibling components and donation (F-031) |

TTI `testType` values are `HIV`, `HBV`, `HCV`, `SYPHILIS`, and `MALARIA`; `result` is
`REACTIVE` or `NON_REACTIVE`. Units stay quarantined until the ABO/Rh result is verified
and all five TTI results are non-reactive. A reactive result discards all units from the
donation and creates confidential staff notifications.

---

## Blood requests API

Hospital staff and administrators submit and manage patient blood requests:

| Method | Path | Allowed Roles | Purpose |
|---|---|---|---|
| `POST` | `/api/blood-requests` | `HOSPITAL`, `ADMIN` | Submit a new blood request with patient details, blood group, component, quantity, and priority (F-040) |
| `GET` | `/api/blood-requests` | `HOSPITAL`, `MANAGER`, `ADMIN`, `LAB_TECH` | List blood requests (scoped to logged-in hospital for `HOSPITAL` role) |
| `GET` | `/api/blood-requests/:idOrCode` | `HOSPITAL`, `MANAGER`, `ADMIN`, `LAB_TECH` | Get detailed status of a blood request by ID or code (`R-XXXXXX`) |
| `POST` | `/api/blood-requests/:idOrCode/crossmatch` | `LAB_TECH`, `MANAGER`, `ADMIN` | Record cross-match test result (`COMPATIBLE` / `INCOMPATIBLE`) for a blood unit (F-041) |
| `GET` | `/api/blood-requests/:idOrCode/crossmatches` | `HOSPITAL`, `LAB_TECH`, `MANAGER`, `ADMIN` | List all cross-match test records for a blood request |
| `GET` | `/api/blood-requests/:idOrCode/crossmatch/:unitCode/check` | `HOSPITAL`, `LAB_TECH`, `MANAGER`, `ADMIN` | Check whether a unit is verified compatible and ready for issuance (blocks un-crossmatched or incompatible units) |
| `POST` | `/api/blood-requests/:idOrCode/reservations` | `LAB_TECH`, `MANAGER`, `ADMIN` | Reserve a cross-matched unit for the request: `{ unitCode, holdMinutes? }` (15–1440, default `RESERVATION_HOLD_MINUTES` = 120) (F-042) |
| `GET` | `/api/blood-requests/:idOrCode/reservations` | `HOSPITAL`, `LAB_TECH`, `MANAGER`, `ADMIN` | Units currently held for the request, with `reservedUntil` and `secondsRemaining` |
| `DELETE` | `/api/blood-requests/:idOrCode/reservations/:unitCode` | `LAB_TECH`, `MANAGER`, `ADMIN` | Release a hold early; the unit goes back to `AVAILABLE` |

A reserved unit is left out of stock counts, FEFO suggestions and every other request until it is
released or its hold time runs out. Lapsed holds are returned to stock automatically (a sweep runs
every minute, and again before any reservation is placed or listed).

---

## Core UI Workflows

### 1. Frontline Blood Collection Desk (`HOSPITAL`, `ADMIN`)
A unified 3-step chair-side wizard replacing disconnected forms:
1. **Donor Check-in:** Search existing donors by Donor ID / Phone, or register a new walk-in donor (`D-XXXXXX`).
2. **Draw & Vitals:** Captures collection parameters (Whole Blood / Apheresis) and chair-side pre-vitals (BP, pulse, Hb). Automatically evaluates donor eligibility against clinical criteria (Hb ≥ 12.5 g/dL, age 18–65, 90-day cooldown) before initializing the collection session.
3. **Unit Barcode Sticker:** Generates the unique `U-YYYY-XXXXXX` quarantine blood bag barcode with immediate browser print capability (100 mm thermal/laser sticker output).

### 2. Central Lab Screening (`LAB_TECH`, `ADMIN`)
* **FIFO Testing Queue:** Displays newly donated units awaiting screening sorted strictly **First In First Out** (`collected_at ASC, id ASC`) so older units are tested before expiring. Paginates to a maximum of **6 cards per page**.
* **Clean Search-Driven Entry:** Below the queue, only the Donation ID / Unit Code search bar is visible by default. Clicking a queue ticket or entering an ID smoothly reveals the active unit banner and fill-in-the-blank options (**ABO/Rh Blood Grouping** and **5-TTI Infection Screening**).
* **Quarantine Lock:** Completed and non-reactive units automatically transition from `QUARANTINE` to `AVAILABLE` in inventory.

### 3. Hospital Blood Request & Cross-match Desk (`HOSPITAL`, `LAB_TECH`, `MANAGER`, `ADMIN`)
* **Request Submission (F-040):** Hospital staff submit patient transfusion requests specifying recipient name, blood group, component, units requested (1–20), priority (`ROUTINE`, `URGENT`, `EMERGENCY`), and optional required-by time. Each request is assigned a sequential ID (`R-XXXXXX`, status `PENDING`).
* **Cross-matching & Issuance Readiness (F-041):** Laboratory technicians test candidate blood units against patient requests. Units in quarantine, discarded, or expired states cannot be cross-matched. Enforces clinical ABO/Rh compatibility rules for red blood cells (PRBC, WHOLE_BLOOD) and plasma (FFP). A unit is strictly blocked from issuance until a cross-match result is recorded as `COMPATIBLE`.
* **Unit Reservation (F-042):** From the cross-match history, lab staff reserve a compatible unit for the request for a chosen hold time (15–1440 minutes, default 120). The **Reserved Units** panel shows a live countdown and a **Release** button; hospital users see the same panel read-only. The request becomes `RESERVED` once all its units are held and returns to `PENDING` if a hold is released or runs out.

### 4. Security & Encryption at Rest (SR-003)
* **AES-256-GCM Encryption:** Sensitive personally identifiable information (PII) and medical records (`medical_history`, `address`, `deferral_reason`, `follow_up_reason`) are encrypted at rest in MySQL using authenticated AES-256-GCM with unique 96-bit IVs and 128-bit authentication tags (`enc:v1:<iv>:<tag>:<ciphertext>`).
* **Transparent Decryption:** Authorized application services, portal views, and REST endpoints transparently decrypt records for clinical use. Legacy unencrypted rows are seamlessly read without errors.
