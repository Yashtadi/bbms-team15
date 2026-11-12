const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

const TTI_TESTS = ['HIV', 'HBV', 'HCV', 'SYPHILIS', 'MALARIA'];
const suffix = Date.now().toString().slice(-6);
const requestCode = `R-99${suffix}`;
const unitCode = `U-2026-99${suffix}`;
const secondUnitCode = `U-2026-98${suffix}`;
const thirdUnitCode = `U-2026-97${suffix}`;
const unitCodes = [unitCode, secondUnitCode, thirdUnitCode];

describe('TC-Req-04: BBMS-F-043 chain of custody (integration)', () => {
  let requestId;
  let unitId;
  let donationId;

  async function cleanUp() {
    const [requests] = await db.query('SELECT id FROM blood_requests WHERE request_code = ?', [requestCode]);
    const [units] = await db.query('SELECT id, donation_id FROM blood_units WHERE unit_code IN (?)', [unitCodes]);
    const requestIds = requests.map((row) => row.id);
    const unitIds = units.map((row) => row.id);
    if (requestIds.length) {
      const [crossmatches] = await db.query('SELECT id FROM crossmatches WHERE request_id IN (?)', [requestIds]);
      const crossmatchIds = crossmatches.map((row) => row.id);
      if (crossmatchIds.length) {
        await db.query(
          "DELETE FROM audit_log WHERE entity_type = 'crossmatch' AND entity_id IN (?)",
          [crossmatchIds.map(String)]
        );
      }
      await db.query('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?', ['blood_request', requestCode]);
      await db.query('DELETE FROM issuances WHERE request_id IN (?)', [requestIds]);
      await db.query('DELETE FROM crossmatches WHERE request_id IN (?)', [requestIds]);
      await db.query('DELETE FROM blood_requests WHERE id IN (?)', [requestIds]);
    }
    if (unitIds.length) {
      await db.query(
        'DELETE FROM audit_log WHERE entity_type = ? AND entity_id IN (?)',
        ['blood_unit', unitCodes]
      );
      await db.query('DELETE FROM blood_units WHERE id IN (?)', [unitIds]);
    }
    const donationIds = [...new Set(units.map((row) => row.donation_id))];
    if (donationIds.length) {
      await db.query('DELETE FROM lab_results WHERE donation_id IN (?)', [donationIds]);
      await db.query('DELETE FROM donations WHERE id IN (?)', [donationIds]);
    }
  }

  beforeAll(async () => {
    await cleanUp();
    const [donation] = await db.query(
      `INSERT INTO donations (donor_id, collected_by, collected_at, status, volume_ml)
       VALUES (1, 3, NOW() - INTERVAL 1 DAY, 'COMPLETED', 450)`
    );
    donationId = donation.insertId;
    await db.query(
      `INSERT INTO lab_results
       (donation_id, test_type, result, method, tested_by, verified_by, verified_at, verification_status)
       VALUES (?, 'ABO_RH', 'O-', NULL, 3, 4, NOW(), 'VERIFIED')`,
      [donationId]
    );
    for (const testType of TTI_TESTS) {
      await db.query(
        `INSERT INTO lab_results (donation_id, test_type, result, method, tested_by)
         VALUES (?, ?, 'NON_REACTIVE', 'ELISA', 3)`,
        [donationId, testType]
      );
    }
    const [unit] = await db.query(
      `INSERT INTO blood_units
       (unit_code, donation_id, component, blood_group, volume_ml, collected_at, expires_at, status)
       VALUES (?, ?, 'PRBC', 'O-', 280, NOW() - INTERVAL 1 DAY, NOW() + INTERVAL 30 DAY, 'AVAILABLE')`,
      [unitCode, donationId]
    );
    unitId = unit.insertId;
    for (const code of [secondUnitCode, thirdUnitCode]) {
      await db.query(
        `INSERT INTO blood_units
         (unit_code, donation_id, component, blood_group, volume_ml, collected_at, expires_at, status)
         VALUES (?, ?, 'PRBC', 'O-', 280, NOW() - INTERVAL 1 DAY, NOW() + INTERVAL 30 DAY, 'AVAILABLE')`,
        [code, donationId]
      );
    }
    const [createdRequest] = await db.query(
      `INSERT INTO blood_requests
       (request_code, hospital_user_id, patient_name, patient_blood_group, component, units_requested, priority, status)
       VALUES (?, 5, 'Custody Test Patient', 'A+', 'PRBC', 2, 'EMERGENCY', 'PENDING')`,
      [requestCode]
    );
    requestId = createdRequest.insertId;
  });

  afterAll(async () => {
    try {
      await cleanUp();
    } finally {
      await db.end();
    }
  });

  it('blocks issue without compatible cross-match, then records staff, timestamp, recipient, unit and request', async () => {
    const blocked = await request(app)
      .post(`/api/blood-requests/${requestCode}/issuances`)
      .set(authHeader('LAB_TECH'))
      .send({ unitCode, receivedBy: 'City General Hospital Ward 4' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('NO_CROSSMATCH');

    for (const code of [unitCode, secondUnitCode]) {
      const crossmatch = await request(app)
        .post(`/api/blood-requests/${requestCode}/crossmatch`)
        .set(authHeader('LAB_TECH'))
        .send({ unitCode: code, result: 'COMPATIBLE' });
      expect(crossmatch.status).toBe(201);
    }

    const held = await request(app)
      .post(`/api/blood-requests/${requestCode}/reservations`)
      .set(authHeader('LAB_TECH'))
      .send({ unitCode: secondUnitCode });
    expect(held.status).toBe(201);

    const issued = await request(app)
      .post(`/api/blood-requests/${requestCode}/issuances`)
      .set(authHeader('MANAGER'))
      .send({ unitCode, receivedBy: 'City General Hospital Ward 4' });

    expect(issued.status).toBe(201);
    expect(issued.body.request).toMatchObject({ id: requestId, requestCode, status: 'RESERVED' });
    expect(issued.body.issuance).toMatchObject({
      requestId,
      requestCode,
      unitId,
      unitCode,
      issuedBy: 2,
      receivedBy: 'City General Hospital Ward 4',
    });
    expect(issued.body.issuance.issuedAt).toEqual(expect.any(String));

    const [unitRows] = await db.query('SELECT status FROM blood_units WHERE id = ?', [unitId]);
    expect(unitRows[0].status).toBe('ISSUED');
    const [requestRows] = await db.query('SELECT status FROM blood_requests WHERE id = ?', [requestId]);
    expect(requestRows[0].status).toBe('RESERVED');
    const [auditRows] = await db.query(
      "SELECT user_id, details FROM audit_log WHERE action = 'UNIT_ISSUED' AND entity_id = ?",
      [unitCode]
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].user_id).toBe(2);
    expect(auditRows[0].details).toMatchObject({
      issuanceId: issued.body.issuance.id,
      requestId,
      requestCode,
      unitId,
      crossmatchId: issued.body.issuance.crossmatchId,
      receivedBy: 'City General Hospital Ward 4',
    });

    const thirdCrossmatch = await request(app)
      .post(`/api/blood-requests/${requestCode}/crossmatch`)
      .set(authHeader('LAB_TECH'))
      .send({ unitCode: thirdUnitCode, result: 'COMPATIBLE' });
    expect(thirdCrossmatch.status).toBe(201);
    const extraHold = await request(app)
      .post(`/api/blood-requests/${requestCode}/reservations`)
      .set(authHeader('LAB_TECH'))
      .send({ unitCode: thirdUnitCode });
    expect(extraHold.status).toBe(409);
    expect(extraHold.body.code).toBe('RESERVATION_LIMIT_REACHED');

    const overIssue = await request(app)
      .post(`/api/blood-requests/${requestCode}/issuances`)
      .set(authHeader('MANAGER'))
      .send({ unitCode: thirdUnitCode, receivedBy: 'City General Hospital Ward 4' });
    expect(overIssue.status).toBe(409);
    expect(overIssue.body.code).toBe('REQUEST_ALLOCATION_FULL');

    const secondIssue = await request(app)
      .post(`/api/blood-requests/${requestCode}/issuances`)
      .set(authHeader('MANAGER'))
      .send({ unitCode: secondUnitCode, receivedBy: 'City General Hospital Ward 4' });
    expect(secondIssue.status).toBe(201);
    expect(secondIssue.body.request.status).toBe('ISSUED');
  });

  it('prevents a unit from being issued twice and lets the hospital read custody history', async () => {
    const duplicate = await request(app)
      .post(`/api/blood-requests/${requestCode}/issuances`)
      .set(authHeader('LAB_TECH'))
      .send({ unitCode, receivedBy: 'City General Hospital Ward 4' });
    expect(duplicate.status).toBe(409);

    const history = await request(app)
      .get(`/api/blood-requests/${requestCode}/issuances`)
      .set(authHeader('HOSPITAL'));
    expect(history.status).toBe(200);
    expect(history.body.issuances).toHaveLength(2);
    expect(history.body.issuances.every((issuance) => (
      issuance.receivedBy === 'City General Hospital Ward 4'
    ))).toBe(true);
  });
});
