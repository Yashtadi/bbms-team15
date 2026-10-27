const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

const DAY_MS = 24 * 60 * 60 * 1000;
const LAB_TECH_USER_ID = 3; // seed.sql

describe('TC-Don-01: record donation session (integration)', () => {
  const timestamp = Date.now();
  const donors = {};

  async function registerDonor(label, consentGiven) {
    const res = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: `Session ${label} Donor`,
        age: 30,
        gender: 'FEMALE',
        contact: '9888777555',
        idProof: `ID-SESSION-${label}-${timestamp}`,
        consentGiven,
      });
    expect(res.status).toBe(201);
    return res.body.donorId;
  }

  function screen(donorId, vitals) {
    return request(app)
      .post(`/api/donors/${donorId}/eligibility`).set(authHeader('LAB_TECH'))
      .send(vitals);
  }

  function startSession(body, role = 'LAB_TECH') {
    return request(app).post('/api/donations').set(authHeader(role)).send(body);
  }

  async function countDonations(donorCode) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS n FROM donations d JOIN donors o ON o.id = d.donor_id
       WHERE o.donor_code = ?`,
      [donorCode]
    );
    return Number(rows[0].n);
  }

  beforeAll(async () => {
    // Eligible: consented and screened ELIGIBLE
    donors.eligible = await registerDonor('ELIGIBLE', true);
    expect((await screen(donors.eligible, { weight: 70, hemoglobin: 14 })).status).toBe(200);

    // Ineligible: consented but screened DEFERRED (weight below 45 kg)
    donors.deferred = await registerDonor('DEFERRED', true);
    expect((await screen(donors.deferred, { weight: 40, hemoglobin: 14 })).status).toBe(422);

    // Consented but never screened: still PENDING
    donors.pending = await registerDonor('PENDING', true);

    // Eligible but no consent
    donors.noConsent = await registerDonor('NOCONSENT', false);
    expect((await screen(donors.noConsent, { weight: 70, hemoglobin: 14 })).status).toBe(200);
  });

  afterAll(async () => {
    await db.end();
  });

  it('session for an eligible donor creates a linked unit in QUARANTINE (AC 1 & AC 3)', async () => {
    const before = Date.now();
    const res = await startSession({
      donorId: donors.eligible,
      donationType: 'WHOLE_BLOOD',
      volumeMl: 450,
      collectedBy: 1, // must be ignored: staff comes from the token
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      donorId: donors.eligible,
      staffId: LAB_TECH_USER_ID,
      donationType: 'WHOLE_BLOOD',
      status: 'IN_PROGRESS',
      unit: { status: 'QUARANTINE', component: 'WHOLE_BLOOD', volumeMl: 450 },
    });
    expect(res.body.unit.unitId).toMatch(/^U-\d{4}-\d{6,}$/);

    // The session is stored with donor, staff, type and date/time
    const [donations] = await db.query(
      `SELECT d.*, o.donor_code FROM donations d JOIN donors o ON o.id = d.donor_id WHERE d.id = ?`,
      [res.body.donationId]
    );
    expect(donations).toHaveLength(1);
    const donation = donations[0];
    expect(donation.donor_code).toBe(donors.eligible);
    expect(donation.collected_by).toBe(LAB_TECH_USER_ID);
    expect(donation.donation_type).toBe('WHOLE_BLOOD');
    expect(donation.status).toBe('IN_PROGRESS');
    expect(donation.collected_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(donation.collected_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    // Exactly one unit, linked to the session, in QUARANTINE
    const [units] = await db.query('SELECT * FROM blood_units WHERE donation_id = ?', [donation.id]);
    expect(units).toHaveLength(1);
    const unit = units[0];
    expect(unit.unit_code).toBe(res.body.unit.unitId);
    expect(unit.status).toBe('QUARANTINE');
    expect(unit.component).toBe('WHOLE_BLOOD');
    expect(unit.blood_group).toBeNull(); // set later by lab testing (F-020)
    expect(unit.volume_ml).toBe(450);
    expect(unit.collected_at.getTime()).toBe(donation.collected_at.getTime());
    expect(unit.expires_at.getTime() - unit.collected_at.getTime()).toBe(35 * DAY_MS);
  });

  it('gives every session a different unit ID; apheresis makes a PLATELETS unit (AC 1 & AC 3)', async () => {
    const first = await startSession({ donorId: donors.eligible, donationType: 'APHERESIS', volumeMl: 250 });
    const second = await startSession({ donorId: donors.eligible, donationType: 'apheresis', volumeMl: 250 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.unit.unitId).not.toBe(second.body.unit.unitId);

    const [units] = await db.query(
      'SELECT u.component, u.collected_at, u.expires_at, d.donation_type FROM blood_units u JOIN donations d ON d.id = u.donation_id WHERE u.unit_code = ?',
      [first.body.unit.unitId]
    );
    expect(units[0].donation_type).toBe('APHERESIS');
    expect(units[0].component).toBe('PLATELETS');
    expect(units[0].expires_at.getTime() - units[0].collected_at.getTime()).toBe(5 * DAY_MS);
  });

  it('ineligible (DEFERRED) donor → 422 and nothing is stored (AC 2)', async () => {
    const res = await startSession({ donorId: donors.deferred, volumeMl: 450 });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DONOR_NOT_ELIGIBLE');
    expect(res.body.message).toContain('DEFERRED');
    expect(await countDonations(donors.deferred)).toBe(0);
  });

  it('donor not yet screened (PENDING) → 422 (AC 2)', async () => {
    const res = await startSession({ donorId: donors.pending, volumeMl: 450 });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DONOR_NOT_ELIGIBLE');
    expect(await countDonations(donors.pending)).toBe(0);
  });

  it('non-consented donor → 422 and nothing is stored (AC 2)', async () => {
    const res = await startSession({ donorId: donors.noConsent, volumeMl: 450 });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
    expect(await countDonations(donors.noConsent)).toBe(0);
  });

  it.each(['ADMIN', 'MANAGER', 'HOSPITAL', 'DONOR'])('%s role → 403 (AC 4)', async (role) => {
    const res = await startSession({ donorId: donors.pending, volumeMl: 450 }, role);

    expect(res.status).toBe(403);
  });

  it('no token → 401', async () => {
    const res = await request(app).post('/api/donations').send({ donorId: donors.eligible, volumeMl: 450 });

    expect(res.status).toBe(401);
  });

  it('invalid donation type or volume → 400 with field errors', async () => {
    const res = await startSession({ donorId: donors.pending, donationType: 'PLASMA', volumeMl: -1 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('donationType');
    expect(res.body.errors).toHaveProperty('volumeMl');
  });

  it('unknown donor → 404', async () => {
    const res = await startSession({ donorId: 'D-999999', volumeMl: 450 });

    expect(res.status).toBe(404);
  });
});
