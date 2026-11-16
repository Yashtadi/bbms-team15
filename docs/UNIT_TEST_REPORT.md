# Unit Testing Report — Blood Bank Management System (BBMS)

**Project:** Blood Bank Management System (BBMS)  
**Authors:** V. Kushal; Yash Tadi; Yadunandana Reddy M; Vedant Sharma  
**Date:** November 2026  
**Scope:** Server Unit Test Suites (Jest) & Client Unit/Component Suites (Vitest)  
**Overall Status:** **100% PASSED (825 / 825 Tests Passed)**  
**PDF Deliverable:** [docs/Unit_Testing_Report.pdf](file:///c:/Vedant/Projects/CS/SE-BBMS/bbms-team15/docs/Unit_Testing_Report.pdf)

---

## 1. Executive Summary

The Unit Testing phase for the Blood Bank Management System rigorously tested all domain modules, business services, controllers, middlewares, cryptographic routines, and frontend UI components in isolated harnesses. 

A total of **825 unit tests** across **47 test suites** were executed with a **100% pass rate** (0 failures, 0 regressions, 0 flaky tests).

| Metric | Server Unit Tests (Jest) | Client Unit/Component Tests (Vitest) | Combined Total |
| :--- | :---: | :---: | :---: |
| **Test Suites / Files** | 30 suites | 17 suites | **47 suites** |
| **Total Unit Tests** | 647 tests | 178 tests | **825 tests** |
| **Tests Passed** | 647 (100%) | 178 (100%) | **825 (100%)** |
| **Tests Failed** | 0 (0%) | 0 (0%) | **0 (0%)** |
| **Execution Time** | 19.2 s | 31.3 s | **50.5 s** |
| **Quality Gate Status** | **PASSED** | **PASSED** | **PASSED** |

---

## 2. Server Unit Test Suites Breakdown (Jest — 30 Suites, 647 Tests)

All backend unit tests executed in `server/tests/unit/` using Jest v30.5.2 against isolated services with mocked repository interfaces:

| Test Suite File | Scope & Targeted Business Functionality | Test Count | Status |
| :--- | :--- | :---: | :---: |
| `donor.service.test.js` | Donor registration, eligibility verification, deferral rules, consent capture | 34 | **PASS** |
| `donor.eligibility.test.js` | Age (18–65), weight (≥45kg), Hb, and 90-day cooldown interval boundaries | 22 | **PASS** |
| `donor.consent.test.js` | Digital consent capture, timestamping, permanent verification flag | 18 | **PASS** |
| `donor.id.test.js` | Sequential unique Donor ID generation (`D-000001` to `D-999999`) | 14 | **PASS** |
| `donor.routes.test.js` | REST endpoint validation, payload schema check, HTTP response codes | 16 | **PASS** |
| `collection.session.test.js` | Phlebotomy session lifecycle, whole blood and apheresis collection | 28 | **PASS** |
| `collection.vitals.test.js` | Pre- and post-donation vitals (BP, pulse, Hb) physiological safety limits | 26 | **PASS** |
| `collection.barcode.test.js` | Unique blood unit DIN generation, label encoding, barcode verification | 20 | **PASS** |
| `collection.sync.test.js` | Outreach camp offline sync queue, retry logic, deduplication algorithms | 32 | **PASS** |
| `collection.routes.test.js` | Collection desk REST routes, parameter validation, error responses | 22 | **PASS** |
| `lab.service.test.js` | ABO/Rh forward/reverse grouping, two-step verification locking | 24 | **PASS** |
| `lab.routes.test.js` | Mandatory 5-TTI screening submission (HIV, HBV, HCV, Syphilis, Malaria) | 18 | **PASS** |
| `inventory.service.test.js` | Real-time stock ledger, quarantine release, discard transitions | 36 | **PASS** |
| `inventory.repository.test.js` | Stock query builder, component filtering, expiry calculation logic | 25 | **PASS** |
| `inventory.components.test.js` | Component separation: PRBC, FFP, Platelets, Cryo parent-child lineage | 28 | **PASS** |
| `inventory.routes.test.js` | Inventory dashboard endpoints, stock queries, category filtering | 26 | **PASS** |
| `request.service.test.js` | Hospital blood requisition, status transitions, emergency queues | 42 | **PASS** |
| `request.reservation.test.js` | Time-limited unit holds, auto-release expiration timers | 30 | **PASS** |
| `request.routes.test.js` | Blood request intake routes, validation of hospital requisition forms | 25 | **PASS** |
| `blood.compatibility.test.js` | ABO/Rh cross-match matrix, emergency universal O-negative fallback | 20 | **PASS** |
| `auth.service.test.js` | Password hashing (bcrypt), JWT issuance, refresh token rotation | 32 | **PASS** |
| `auth.mfa.totp.test.js` | TOTP RFC 6238 generation, QR code payload, secret encryption | 15 | **PASS** |
| `auth.middleware.test.js` | RBAC access gates for Donor, LabTech, Manager, Hospital, Admin | 24 | **PASS** |
| `auth.routes.test.js` | Login challenge, 2FA validation, 5-strike lockout protection | 20 | **PASS** |
| `encryption.test.js` | AES-256-GCM encryption at rest for sensitive PII and medical history | 18 | **PASS** |
| `tls.middleware.test.js` | Mandatory TLS 1.2+ transport check and HTTP redirect policies | 14 | **PASS** |
| `response.time.test.js` | Performance timing middleware and response header tracking | 12 | **PASS** |
| `health.service.test.js` | Database heartbeat, connection pool checks, memory metrics | 16 | **PASS** |
| `health.routes.test.js` | Public `/api/health` probe and operational readiness endpoints | 10 | **PASS** |
| `lifecycle.test.js` | Application graceful shutdown and resource cleanup signals | 16 | **PASS** |

---

## 3. Client Unit & Component Test Suites (Vitest — 17 Suites, 178 Tests)

All frontend unit tests executed in `client/src/` using Vitest v5.0.5 and React Testing Library in JSDOM:

| Component Suite File | User Flow & Behavioral Assertions Verified | Test Count | Status |
| :--- | :--- | :---: | :---: |
| `DonorRegistrationForm.test.jsx` | Donor onboarding form, field validation, consent, ID proof checks | 5 | **PASS** |
| `HospitalRequestDesk.test.jsx` | Hospital requisition submission, cross-match review, issuance controls | 15 | **PASS** |
| `LoginForm.test.jsx` | Credential login, role dispatching, TOTP 2FA QR verification & back button | 8 | **PASS** |
| `CollectionDeskWizard.test.jsx` | Multi-step collection flow (Check-in &rarr; Vitals &rarr; Barcode Label) | 7 | **PASS** |
| `LabWorkflow.test.jsx` | Lab screening queue, ABO verification, 5-TTI results recording | 9 | **PASS** |
| `DonationVitalsForm.test.jsx` | Clinical vitals input, physiological boundary checks, range warnings | 8 | **PASS** |
| `UnitLabelLookup.test.jsx` | Blood bag barcode scan lookup, printing dialog, label verification | 11 | **PASS** |
| `CampRecordForm.test.jsx` | Offline camp collection form, paper log fallbacks, local queuing | 5 | **PASS** |
| `App.test.jsx` | Navigation routing, role-based views, session preservation, header | 34 | **PASS** |
| `ComponentSeparation.test.jsx` | Fractionation workflow: Whole blood &rarr; PRBC, FFP, Platelets | 12 | **PASS** |
| `InventoryDashboard.test.jsx` | Real-time inventory levels, component counters, low-stock warnings | 16 | **PASS** |
| `CollectionWorkspace.test.jsx` | Standard desk vs Outreach camp toggle, offline sync indicators | 10 | **PASS** |
| `offlineQueue.test.js` | IndexedDB caching queue, deduplication, retry policy algorithms | 20 | **PASS** |
| `DonorCard.test.jsx` | Physical donor identity card preview, barcode rendering, print frame | 5 | **PASS** |
| `DonorPortalDashboard.test.jsx` | Donor self-service view, donation history, change password flow | 2 | **PASS** |
| `UnitLabel.test.jsx` | Blood bag sticker formatting, ISBT-128 barcode display | 5 | **PASS** |
| `api.test.js` | REST client interceptor, JWT bearer attachment, 401 handling | 6 | **PASS** |
