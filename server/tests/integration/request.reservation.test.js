const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

// The DB is shared by all integration suites, so this suite only uses AB+ stock (no other suite
// counts it) and request codes in the R-9903xx range, and removes everything it adds.
const TTI_TESTS = ['HIV', 'HBV', 'HCV', 'SYPHILIS', 'MALARIA'];
const REQ_A = 'R-990301'; // AB+ PRBC, 2 units
const REQ_B = 'R-990302'; // AB+ PRBC, 1 unit

describe('TC-Req-03: BBMS-F-042 reserve a matched unit for a request (integration)', () => {
  let donationId;
  let unit1;
  let unit2;
  let reqAId;
  let reqBId;

  async function insertReleasedUnit(code) {
    const [res] = await db.query(
      `INSERT INTO blood_units (unit_code, donation_id, component, blood_group, volume_ml, collected_at, expires_at, status)
       VALUES (?, ?, 'PRBC', 'AB+', 280, NOW() - INTERVAL 1 DAY, NOW() + INTERVAL 30 DAY, 'AVAILABLE')`,
      [code, donationId]
    );
    return { id: res.insertId, code };
  }

  async function insertRequest(code, unitsRequested) {
    const [res] = await db.query(
      `INSERT INTO blood_requests (request_code, hospital_user_id, patient_name, patient_blood_group, component,
                                   units_requested, priority, status)
       VALUES (?, 5, 'Reservation Patient', 'AB+', 'PRBC', ?, 'URGENT', 'PENDING')`,
      [code, unitsRequested]
    );
    return res.insertId;
  }

  async function cleanUp() {
    const [units] = await db.query("SELECT id FROM blood_units WHERE unit_code LIKE 'U-2026-9903%'");
    const [requests] = await db.query("SELECT id FROM blood_requests WHERE request_code LIKE 'R-9903%'");
    const unitIds = units.map((u) => u.id);
    const requestIds = requests.map((r) => r.id);
    if (unitIds.length) await db.query('DELETE FROM crossmatches WHERE unit_id IN (?)', [unitIds]);
    if (requestIds.length) await db.query('DELETE FROM crossmatches WHERE request_id IN (?)', [requestIds]);
    if (unitIds.length) {
      const [donations] = await db.query('SELECT DISTINCT donation_id FROM blood_units WHERE id IN (?)', [unitIds]);
      await db.query('DELETE FROM blood_units WHERE id IN (?)', [unitIds]);
      const donationIds = donations.map((d) => d.donation_id);
      await db.query('DELETE FROM lab_results WHERE donation_id IN (?)', [donationIds]);
      await db.query('DELETE FROM donations WHERE id IN (?)', [donationIds]);
    }
    if (requestIds.length) await db.query('DELETE FROM blood_requests WHERE id IN (?)', [requestIds]);
  }

  const crossmatch = (requestCode, unitCode, result = 'COMPATIBLE') =>
    request(app)
      .post(`/api/blood-requests/${requestCode}/crossmatch`)
      .set(authHeader('LAB_TECH'))
      .send({ unitCode, result });

  const reserve = (requestCode, body, role = 'LAB_TECH') =>
    request(app).post(`/api/blood-requests/${requestCode}/reservations`).set(authHeader(role)).send(body);

  async function abPlusPrbcStock() {
    const res = await request(app).get('/api/inventory/summary').set(authHeader('MANAGER'));
    expect(res.status).toBe(200);
    const row = res.body.stock.find((s) => s.bloodGroup === 'AB+' && s.component === 'PRBC');
    return row ? row.units : 0;
  }

  async function unitRow(id) {
    const [rows] = await db.query(
      'SELECT status, reserved_for_request_id, reserved_until, reserved_by FROM blood_units WHERE id = ?',
      [id]
    );
    return rows[0];
  }

  async function requestStatus(id) {
    const [rows] = await db.query('SELECT status FROM blood_requests WHERE id = ?', [id]);
    return rows[0].status;
  }

  beforeAll(async () => {
    await cleanUp();

    const [donation] = await db.query(
      `INSERT INTO donations (donor_id, collected_by, collected_at, status, volume_ml)
       VALUES (1, 3, NOW() - INTERVAL 1 DAY, 'COMPLETED', 450)`
    );
    donationId = donation.insertId;
    await db.query(
      `INSERT INTO lab_results (donation_id, test_type, result, method, tested_by, verified_by, verified_at, verification_status)
       VALUES (?, 'ABO_RH', 'AB+', NULL, 3, 4, NOW(), 'VERIFIED')`,
      [donationId]
    );
    for (const test of TTI_TESTS) {
      await db.query(
        `INSERT INTO lab_results (donation_id, test_type, result, method, tested_by)
         VALUES (?, ?, 'NON_REACTIVE', 'ELISA', 3)`,
        [donationId, test]
      );
    }

    unit1 = await insertReleasedUnit('U-2026-990301');
    unit2 = await insertReleasedUnit('U-2026-990302');
    reqAId = await insertRequest(REQ_A, 2);
    reqBId = await insertRequest(REQ_B, 1);
  });

  afterAll(async () => {
    try {
      await cleanUp();
    } finally {
      await db.end();
    }
  });

  it('refuses to reserve a unit that has no cross-match yet (422)', async () => {
    const res = await reserve(REQ_A, { unitCode: unit1.code });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_CROSSMATCH');
    expect((await unitRow(unit1.id)).status).toBe('AVAILABLE');
  });

  it('rejects a hold window below the 15-minute minimum (400)', async () => {
    const res = await reserve(REQ_A, { unitCode: unit1.code, holdMinutes: 14 });
    expect(res.status).toBe(400);
    expect(res.body.errors.holdMinutes).toMatch(/between 15 and 1440/);
  });

  it('does not let a hospital place a hold (403)', async () => {
    const res = await reserve(REQ_A, { unitCode: unit1.code }, 'HOSPITAL');
    expect(res.status).toBe(403);
  });

  it('reserves a cross-matched unit for the chosen window and takes it out of stock (201)', async () => {
    const stockBefore = await abPlusPrbcStock();
    expect((await crossmatch(REQ_A, unit1.code)).status).toBe(201);

    const res = await reserve(REQ_A, { unitCode: unit1.code, holdMinutes: 30 });

    expect(res.status).toBe(201);
    expect(res.body.reservation).toMatchObject({
      requestCode: REQ_A,
      unitCode: unit1.code,
      holdMinutes: 30,
      requestStatus: 'PENDING', // 1 of 2 units held
      activeReservations: 1,
    });
    expect(res.body.reservation.secondsRemaining).toBeGreaterThan(29 * 60);
    expect(res.body.reservation.secondsRemaining).toBeLessThanOrEqual(30 * 60);

    const row = await unitRow(unit1.id);
    expect(row.status).toBe('RESERVED');
    expect(row.reserved_for_request_id).toBe(reqAId);
    expect(row.reserved_by).toBe(3);

    const [audit] = await db.query(
      "SELECT user_id FROM audit_log WHERE action = 'UNIT_RESERVED' AND entity_id = ? ORDER BY id DESC LIMIT 1",
      [unit1.code]
    );
    expect(audit[0].user_id).toBe(3);

    expect(await abPlusPrbcStock()).toBe(stockBefore - 1);
  });

  it('excludes the held unit from FEFO suggestions for another request', async () => {
    const res = await request(app).get(`/api/blood-requests/${REQ_B}/fefo-suggestions`).set(authHeader('LAB_TECH'));
    expect(res.status).toBe(200);
    const codes = res.body.allCompatibleUnits.map((u) => u.unitCode);
    expect(codes).not.toContain(unit1.code);
    expect(codes).toContain(unit2.code);
  });

  it('blocks another request from cross-matching or reserving the held unit (409)', async () => {
    const cm = await crossmatch(REQ_B, unit1.code);
    expect(cm.status).toBe(409);
    expect(cm.body.code).toBe('RESERVED_FOR_OTHER_REQUEST');

    const res = await reserve(REQ_B, { unitCode: unit1.code });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RESERVED_FOR_OTHER_REQUEST');
  });

  it('refuses to reserve the same unit twice for one request (409)', async () => {
    const res = await reserve(REQ_A, { unitCode: unit1.code });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_RESERVED');
  });

  it('marks the request RESERVED once every requested unit is held', async () => {
    expect((await crossmatch(REQ_A, unit2.code)).status).toBe(201);
    const res = await reserve(REQ_A, { unitCode: unit2.code });

    expect(res.status).toBe(201);
    expect(res.body.reservation.requestStatus).toBe('RESERVED');
    expect(res.body.reservation.holdMinutes).toBe(120); // default window
    expect(await requestStatus(reqAId)).toBe('RESERVED');
  });

  it("lets the hospital see its request's holds, soonest expiry first", async () => {
    const res = await request(app).get(`/api/blood-requests/${REQ_A}/reservations`).set(authHeader('HOSPITAL'));
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('RESERVED');
    expect(res.body.reservations.map((r) => r.unitCode)).toEqual([unit1.code, unit2.code]);
    expect(res.body.reservations[0].reservedBy.fullName).toBe('Labtech 1');
  });

  it('releases a hold early: the unit is back in stock and the request is PENDING again', async () => {
    const res = await request(app)
      .delete(`/api/blood-requests/${REQ_A}/reservations/${unit2.code}`)
      .set(authHeader('MANAGER'));

    expect(res.status).toBe(200);
    expect(res.body.released).toMatchObject({ unitCode: unit2.code, unitStatus: 'AVAILABLE', requestStatus: 'PENDING' });
    expect(await unitRow(unit2.id)).toMatchObject({ status: 'AVAILABLE', reserved_for_request_id: null, reserved_until: null });
    expect(await requestStatus(reqAId)).toBe('PENDING');

    const again = await request(app)
      .delete(`/api/blood-requests/${REQ_A}/reservations/${unit2.code}`)
      .set(authHeader('MANAGER'));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('NOT_RESERVED');
  });

  it('puts a unit back in stock as soon as its hold window runs out, then lets another request reserve it', async () => {
    const stockWhileHeld = await abPlusPrbcStock();
    await db.query('UPDATE blood_units SET reserved_until = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [unit1.id]);

    // Stock counts it again straight away, before any sweep has run
    expect(await abPlusPrbcStock()).toBe(stockWhileHeld + 1);

    // Listing sweeps lapsed holds: the hold is gone and the row is reset with a system audit entry
    const list = await request(app).get(`/api/blood-requests/${REQ_A}/reservations`).set(authHeader('LAB_TECH'));
    expect(list.status).toBe(200);
    expect(list.body.reservations).toEqual([]);
    expect(await unitRow(unit1.id)).toMatchObject({ status: 'AVAILABLE', reserved_for_request_id: null });
    const [audit] = await db.query(
      "SELECT user_id FROM audit_log WHERE action = 'RESERVATION_EXPIRED' AND entity_id = ? ORDER BY id DESC LIMIT 1",
      [unit1.code]
    );
    expect(audit[0].user_id).toBeNull();

    expect((await crossmatch(REQ_B, unit1.code)).status).toBe(201);
    const res = await reserve(REQ_B, { unitCode: unit1.code, holdMinutes: 15 });
    expect(res.status).toBe(201);
    expect(res.body.reservation.requestStatus).toBe('RESERVED');
  });

  it('refuses a third hold on a one-unit request that is already fully reserved (409)', async () => {
    expect((await crossmatch(REQ_B, unit2.code)).status).toBe(201);
    const res = await reserve(REQ_B, { unitCode: unit2.code });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RESERVATION_LIMIT_REACHED');
  });
});
