const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

describe('TC-Don-03: blood-unit barcode label lookup (integration)', () => {
  let donorId;
  let unitId;

  function startSession() {
    return request(app)
      .post('/api/donations').set(authHeader('LAB_TECH'))
      .send({ donorId, volumeMl: 450 });
  }

  function lookUp(code, role = 'LAB_TECH') {
    return request(app).get(`/api/donations/units/${encodeURIComponent(code)}`).set(authHeader(role));
  }

  beforeAll(async () => {
    // An eligible, consented donor with a fresh donation session (F-010)
    const registered = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: 'Barcode Donor',
        age: 30,
        gender: 'FEMALE',
        contact: '9888777444',
        idProof: `ID-BARCODE-${Date.now()}`,
        consentGiven: true,
      });
    expect(registered.status).toBe(201);
    donorId = registered.body.donorId;

    const screened = await request(app)
      .post(`/api/donors/${donorId}/eligibility`).set(authHeader('LAB_TECH'))
      .send({ weight: 70, hemoglobin: 14 });
    expect(screened.status).toBe(200);

    const session = await startSession();
    expect(session.status).toBe(201);
    unitId = session.body.unit.unitId;
  });

  afterAll(async () => {
    await db.end();
  });

  it('looking up by barcode returns the correct unit, with PENDING blood group (AC 1, 2 & 4)', async () => {
    const res = await lookUp(unitId);

    expect(res.status).toBe(200);
    expect(res.body.unitId).toBe(unitId);
    expect(res.body.barcode).toEqual({ format: 'CODE128', value: unitId });
    expect(res.body).toMatchObject({
      bloodGroup: 'PENDING',
      component: 'WHOLE_BLOOD',
      volumeMl: 450,
      status: 'QUARANTINE',
    });

    // Same unit as in the database, including its collection date
    const [rows] = await db.query('SELECT * FROM blood_units WHERE unit_code = ?', [unitId]);
    expect(rows).toHaveLength(1);
    expect(res.body.donationId).toBe(rows[0].donation_id);
    expect(new Date(res.body.collectedAt).getTime()).toBe(rows[0].collected_at.getTime());
    expect(new Date(res.body.expiresAt).getTime()).toBe(rows[0].expires_at.getTime());
  });

  it('gives every unit a different barcode (AC 1)', async () => {
    const second = await startSession();
    expect(second.status).toBe(201);

    const res = await lookUp(second.body.unit.unitId);

    expect(res.status).toBe(200);
    expect(res.body.barcode.value).toBe(second.body.unit.unitId);
    expect(res.body.barcode.value).not.toBe(unitId);
  });

  it('finds the unit when the scanned code is lower case or padded with spaces (AC 4)', async () => {
    const res = await lookUp(`  ${unitId.toLowerCase()} `);

    expect(res.status).toBe(200);
    expect(res.body.unitId).toBe(unitId);
  });

  it('shows the tested blood group for a unit that has been through the lab (AC 2)', async () => {
    const res = await lookUp('U-2026-000001'); // seed.sql: O- PRBC, AVAILABLE

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unitId: 'U-2026-000001', bloodGroup: 'O-', component: 'PRBC' });
  });

  it.each(['MANAGER', 'ADMIN'])('%s can look a unit up', async (role) => {
    const res = await lookUp(unitId, role);

    expect(res.status).toBe(200);
  });

  it('unknown unit → 404', async () => {
    const res = await lookUp('U-1999-999999');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Blood unit not found');
  });

  it.each(['D-000001', 'hello'])('malformed code %p → 400', async (code) => {
    const res = await lookUp(code);

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('unitId');
  });

  it.each(['HOSPITAL', 'DONOR'])('%s role → 403', async (role) => {
    const res = await lookUp(unitId, role);

    expect(res.status).toBe(403);
  });

  it('no token → 401', async () => {
    const res = await request(app).get(`/api/donations/units/${unitId}`);

    expect(res.status).toBe(401);
  });
});
