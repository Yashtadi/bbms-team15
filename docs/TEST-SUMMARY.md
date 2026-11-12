# Sprint 2 Test Summary

## Executed

| Area | Command / scope | Result |
|---|---|---|
| Server unit tests | `cd server && npm run test:unit -- --runInBand` | 647 passed across 30 suites |
| Client tests | `cd client && npm test` | 177 passed across 17 files |
| Request desk client tests | `cd client && npm test -- src/components/HospitalRequestDesk.test.jsx` | 15 passed |
| Client production build | `cd client && npm run build` | Passed |
| Client lint | `cd client && npm run lint` | Failed: 22 errors and 1 warning across the client tree; see command output for locations |

## Integration and remaining deliverable

- The final revision's MySQL-backed integration suite is being validated by GitHub Actions. The suite includes issuance allocation/custody and MFA lockout checks; consult the PR check before merging.
- The Sprint 2 demo video is still pending; see [README](../README.md) for product setup and workflows.

The lint failure is in the existing client tree and does not affect the passing client test/build commands.
