# Sprint 2 Requirements Traceability Matrix

| Requirement | GitHub issue | Implementation | Verification |
|---|---:|---|---|
| BBMS-F-043: write an immutable custody record when issuing a unit, linked to staff, time, recipient, unit, and request | #27 | `POST /api/blood-requests/:idOrCode/issuances`; request and inventory state changes plus issuance insert are transactional | TC-Req-04 service tests and `tests/integration/request.issuance.test.js` |
| BBMS-F-044: prioritize emergency requests and suggest O-negative units when the patient group is unknown | #28 | Emergency-first request queue; O-negative FEFO fallback limited to emergency PRBC requests with unknown group; cross-match remains required | TC-Req-05 request compatibility and inventory service tests; HospitalRequestDesk tests |
| BBMS-SR-005: require MFA for Admin and Blood Bank Manager accounts | #32 | TOTP enrollment and login challenge; encrypted secret storage; setup/challenge tokens rejected by protected routes | TC-Sec-05 auth service, TOTP, middleware, and integration tests |
| Sprint 2 demo and final documentation | #38 | README, this RTM, test summary, and deviations updated | Documentation review; **demo video remains pending** |

Integration test coverage is implemented, but DB-backed tests must be run against the configured MySQL test database before claiming they passed. The demo video requirement is not complete until a recording of the working product is added to the repository.
