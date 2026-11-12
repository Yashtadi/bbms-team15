const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

describe('TC-Req-02: BBMS-F-041 Cross-match & Issuance Blocking (Integration)', () => {
  let testRequestId = 'R-990001';
  let testRequestNumId = null;

  beforeAll(async () => {
    // Clean up any remnants from prior runs
    await db.query("DELETE FROM crossmatches WHERE request_id IN (SELECT id FROM blood_requests WHERE request_code = 'R-990001')");
    await db.query("DELETE FROM blood_requests WHERE request_code = 'R-990001'");

    const [res] = await db.query(
      `INSERT INTO blood_requests (request_code, hospital_user_id, patient_name, patient_blood_group, component, units_requested, priority, status)
       VALUES (?, 5, 'Integration Patient', 'A+', 'PRBC', 1, 'ROUTINE', 'PENDING')`,
      [testRequestId]
    );
    testRequestNumId = res.insertId;
  });

  afterAll(async () => {
    try {
      if (testRequestNumId) {
        await db.query('DELETE FROM crossmatches WHERE request_id = ?', [testRequestNumId]);
        await db.query('DELETE FROM blood_requests WHERE id = ?', [testRequestNumId]);
      }
      await db.query('DELETE FROM crossmatches WHERE request_id IN (1, 2)');
    } finally {
      await db.end();
    }
  });

  const compatibleUnit = 'U-2026-000001'; // O-, PRBC, AVAILABLE
  const incompatibleGroupUnit = 'U-2026-000004'; // A+, PRBC, AVAILABLE (incompatible with O- patient)
  const quarantineUnit = 'U-2026-000007'; // QUARANTINE
  const discardedUnit = 'U-2026-000006'; // DISCARDED
  const expiredUnit = 'U-2026-000003'; // EXPIRED

  it('blocks issuance when no cross-match has been recorded for the unit', async () => {
    const res = await request(app)
      .get(`/api/blood-requests/${testRequestId}/crossmatch/${compatibleUnit}/check`)
      .set(authHeader('LAB_TECH'));

    expect(res.status).toBe(200);
    expect(res.body.readyForIssuance).toBe(false);
    expect(res.body.error).toBe('NO_CROSSMATCH');
    expect(res.body.message).toMatch(/issuance is blocked/i);
  });

  it('blocks cross-matching a unit in QUARANTINE (422)', async () => {
    const res = await request(app)
      .post(`/api/blood-requests/${testRequestId}/crossmatch`)
      .set(authHeader('LAB_TECH'))
      .send({ unitCode: quarantineUnit, result: 'COMPATIBLE' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/quarantine/i);
  });

  it('blocks cross-matching a DISCARDED unit (422)', async () => {
    const res = await request(app)
      .post(`/api/blood-requests/${testRequestId}/crossmatch`)
      .set(authHeader('LAB_TECH'))
      .send({ unitCode: discardedUnit, result: 'COMPATIBLE' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/discarded/i);
  });

  it('blocks cross-matching an EXPIRED unit (422)', async () => {
    const res = await request(app)
      .post(`/api/blood-requests/${testRequestId}/crossmatch`)
      .set(authHeader('LAB_TECH'))
      .send({ unitCode: expiredUnit, result: 'COMPATIBLE' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('blocks marking COMPATIBLE when blood groups are clinically incompatible (422)', async () => {
    // R-000002 has patient with blood group O-. Unit U-2026-000004 has blood group A+.
    const res = await request(app)
      .post('/api/blood-requests/R-000002/crossmatch')
      .set(authHeader('LAB_TECH'))
      .send({ unitCode: incompatibleGroupUnit, result: 'COMPATIBLE' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/clinically incompatible/i);
  });

  it('records an INCOMPATIBLE cross-match and verifies issuance remains blocked', async () => {
    // Record INCOMPATIBLE for R-000002 with A+ unit
    const postRes = await request(app)
      .post('/api/blood-requests/R-000002/crossmatch')
      .set(authHeader('LAB_TECH'))
      .send({ unitCode: incompatibleGroupUnit, result: 'INCOMPATIBLE' });

    expect(postRes.status).toBe(201);
    expect(postRes.body.crossmatch.result).toBe('INCOMPATIBLE');
    expect(postRes.body.crossmatch.readyForIssuance).toBe(false);

    // Verify issuance check blocks unit
    const checkRes = await request(app)
      .get(`/api/blood-requests/R-000002/crossmatch/${incompatibleGroupUnit}/check`)
      .set(authHeader('LAB_TECH'));

    expect(checkRes.status).toBe(200);
    expect(checkRes.body.readyForIssuance).toBe(false);
    expect(checkRes.body.error).toBe('INCOMPATIBLE_CROSSMATCH');
    expect(checkRes.body.message).toMatch(/issuance is blocked/i);
  });

  it('records a COMPATIBLE cross-match and verifies issuance is ready (201)', async () => {
    // Patient One (A+) with Unit U-2026-000001 (O- PRBC)
    const postRes = await request(app)
      .post(`/api/blood-requests/${testRequestId}/crossmatch`)
      .set(authHeader('LAB_TECH'))
      .send({ unitCode: compatibleUnit, result: 'COMPATIBLE' });

    expect(postRes.status).toBe(201);
    expect(postRes.body.crossmatch.result).toBe('COMPATIBLE');
    expect(postRes.body.crossmatch.readyForIssuance).toBe(true);

    const crossmatchId = postRes.body.crossmatch.id;
    expect(crossmatchId).toBeDefined();

    // Verify database row in crossmatches
    const [rows] = await db.query('SELECT * FROM crossmatches WHERE id = ?', [crossmatchId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].request_id).toBe(testRequestNumId);
    expect(rows[0].unit_id).toBe(1);
    expect(rows[0].result).toBe('COMPATIBLE');
    expect(rows[0].performed_by).toBe(3); // Labtech 1

    // Verify immutable audit log
    const [auditRows] = await db.query(
      "SELECT * FROM audit_log WHERE entity_type = 'crossmatch' AND entity_id = ? AND action = 'CROSSMATCH_RECORDED'",
      [String(crossmatchId)]
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].user_id).toBe(3);

    // Verify check endpoint confirms readiness
    const checkRes = await request(app)
      .get(`/api/blood-requests/${testRequestId}/crossmatch/${compatibleUnit}/check`)
      .set(authHeader('LAB_TECH'));

    expect(checkRes.status).toBe(200);
    expect(checkRes.body.readyForIssuance).toBe(true);
    expect(checkRes.body.crossmatchId).toBe(crossmatchId);
    expect(checkRes.body.result).toBe('COMPATIBLE');
  });

  it('lists crossmatches for a request (200)', async () => {
    const res = await request(app)
      .get(`/api/blood-requests/${testRequestId}/crossmatches`)
      .set(authHeader('HOSPITAL'));

    expect(res.status).toBe(200);
    expect(res.body.request.requestCode).toBe(testRequestId);
    expect(res.body.crossmatches.length).toBeGreaterThanOrEqual(1);

    const cm = res.body.crossmatches.find((c) => c.unitCode === compatibleUnit);
    expect(cm).toBeDefined();
    expect(cm.result).toBe('COMPATIBLE');
    expect(cm.readyForIssuance).toBe(true);
    expect(cm.performedBy.fullName).toBe('Labtech 1');
  });
});
