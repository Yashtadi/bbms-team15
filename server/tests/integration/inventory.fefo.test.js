const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

// TC-Inv-04 / BBMS-F-033 (SRS §4.4): FEFO allocation (First-Expiry-First-Out)
describe('TC-Inv-04: FEFO Allocation (First-Expiry-First-Out) Integration', () => {
  afterAll(async () => {
    await db.end();
  });

  it('rejects unauthenticated requests (401)', async () => {
    const res = await request(app).get('/api/inventory/fefo?bloodGroup=A+&component=PRBC');
    expect(res.status).toBe(401);
  });

  it('blocks DONOR role from accessing FEFO suggestions (403)', async () => {
    const res = await request(app)
      .get('/api/inventory/fefo?bloodGroup=A+&component=PRBC')
      .set(authHeader('DONOR'));
    expect(res.status).toBe(403);
  });

  it('suggests the soonest-to-expire compatible unit first (FEFO) for red cell request', async () => {
    // Patient A+ needing PRBC:
    // Compatible seed units:
    // - U-2026-000004: A+, expires in +2 days
    // - U-2026-000001: O-, expires in +32 days
    const res = await request(app)
      .get('/api/inventory/fefo?patientBloodGroup=A%2B&component=PRBC&unitsRequested=1')
      .set(authHeader('MANAGER'));

    expect(res.status).toBe(200);
    expect(res.body.patientBloodGroup).toBe('A+');
    expect(res.body.component).toBe('PRBC');
    expect(res.body.totalCompatibleFound).toBeGreaterThanOrEqual(2);

    // FEFO: U-2026-000004 must be Rank 1 because it expires soonest!
    expect(res.body.suggestedUnits.length).toBe(1);
    const topSuggestion = res.body.suggestedUnits[0];
    expect(topSuggestion.unitCode).toBe('U-2026-000004');
    expect(topSuggestion.bloodGroup).toBe('A+');
    expect(topSuggestion.rank).toBe(1);
    expect(topSuggestion.daysRemaining).toBeLessThanOrEqual(3);

    // Second unit in allCompatibleUnits must be U-2026-000001
    const secondUnit = res.body.allCompatibleUnits.find((u) => u.unitCode === 'U-2026-000001');
    expect(secondUnit).toBeDefined();
    expect(secondUnit.rank).toBeGreaterThan(topSuggestion.rank);
    expect(new Date(secondUnit.expiresAt).getTime()).toBeGreaterThan(new Date(topSuggestion.expiresAt).getTime());
  });

  it('filters out incompatible blood groups and only allocates compatible units', async () => {
    // Patient O- needing PRBC:
    // Incompatible: U-2026-000004 (A+)
    // Compatible: U-2026-000001 (O-)
    const res = await request(app)
      .get('/api/inventory/fefo?patientBloodGroup=O-&component=PRBC&unitsRequested=1')
      .set(authHeader('LAB_TECH'));

    expect(res.status).toBe(200);
    const unitCodes = res.body.allCompatibleUnits.map((u) => u.unitCode);
    expect(unitCodes).toContain('U-2026-000001');
    expect(unitCodes).not.toContain('U-2026-000004');
  });

  it('suggests FEFO units for a specific blood request via /api/blood-requests/:idOrCode/fefo-suggestions', async () => {
    // Seed request R-000001 is for John Doe, A+, PRBC, 2 units
    const res = await request(app)
      .get('/api/blood-requests/R-000001/fefo-suggestions')
      .set(authHeader('LAB_TECH'));

    expect(res.status).toBe(200);
    expect(res.body.requestCode).toBe('R-000001');
    expect(res.body.patientBloodGroup).toBe('A+');
    expect(res.body.suggestedUnits.length).toBeGreaterThanOrEqual(1);

    // Soonest-to-expire compatible unit is suggested first
    expect(res.body.suggestedUnits[0].unitCode).toBe('U-2026-000004');
  });

  it('does not include QUARANTINE, DISCARDED, or EXPIRED units in FEFO suggestions', async () => {
    const res = await request(app)
      .get('/api/inventory/fefo?patientBloodGroup=B%2B&component=WHOLE_BLOOD')
      .set(authHeader('HOSPITAL'));

    expect(res.status).toBe(200);
    const unitCodes = res.body.allCompatibleUnits.map((u) => u.unitCode);

    // Seed unit 6 is DISCARDED: must not be allocated
    expect(unitCodes).not.toContain('U-2026-000006');

    // Seed unit 7 is QUARANTINE: must not be allocated
    expect(unitCodes).not.toContain('U-2026-000007');

    // Seed unit 3 is EXPIRED: must not be allocated
    expect(unitCodes).not.toContain('U-2026-000003');
  });
});
