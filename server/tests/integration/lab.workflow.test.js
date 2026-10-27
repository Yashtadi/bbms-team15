const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader, authHeaderForUser } = require('../helpers/auth');

describe('TC-Test-01 to TC-Test-04: blood-group verification and TTI workflow', () => {
  let safeDonationId;
  let safeUnitCode;
  let reactiveDonationId;
  let reactiveUnitCode;
  let untouchedDonationId;

  async function createDonation(label) {
    const donor = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: `Lab ${label} Donor`,
        age: 30,
        gender: 'FEMALE',
        contact: '9888777444',
        idProof: `ID-LAB-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        consentGiven: true,
      });
    expect(donor.status).toBe(201);

    const eligibility = await request(app)
      .post(`/api/donors/${donor.body.donorId}/eligibility`).set(authHeader('LAB_TECH'))
      .send({ weight: 70, hemoglobin: 14 });
    expect(eligibility.status).toBe(200);

    const session = await request(app)
      .post('/api/donations').set(authHeader('LAB_TECH'))
      .send({ donorId: donor.body.donorId, volumeMl: 450 });
    expect(session.status).toBe(201);
    return session.body;
  }

  async function recordTti(donationId, testType, result = 'NON_REACTIVE') {
    return request(app)
      .post(`/api/lab/donations/${donationId}/tti-results`).set(authHeader('LAB_TECH'))
      .send({ testType, result, method: 'ELISA' });
  }

  beforeAll(async () => {
    const safe = await createDonation('SAFE');
    safeDonationId = safe.donationId;
    safeUnitCode = safe.unit.unitId;

    const reactive = await createDonation('REACTIVE');
    reactiveDonationId = reactive.donationId;
    reactiveUnitCode = reactive.unit.unitId;

    const untouched = await createDonation('UNTOUCHED');
    untouchedDonationId = untouched.donationId;
  });

  afterAll(async () => {
    await db.end();
  });

  it('requires a different verifier, flags mismatches, and locks only a matching ABO/Rh result', async () => {
    const entered = await request(app)
      .post(`/api/lab/donations/${safeDonationId}/blood-group`).set(authHeader('LAB_TECH'))
      .send({ aboGroup: 'A', rh: '+' });
    expect(entered.status).toBe(201);
    expect(entered.body.verificationStatus).toBe('PENDING');

    const selfVerification = await request(app)
      .post(`/api/lab/donations/${safeDonationId}/blood-group/verify`).set(authHeader('LAB_TECH'))
      .send({ aboGroup: 'A', rh: '+' });
    expect(selfVerification.status).toBe(409);

    const mismatch = await request(app)
      .post(`/api/lab/donations/${safeDonationId}/blood-group/verify`)
      .set(authHeaderForUser(4, 'LAB_TECH'))
      .send({ aboGroup: 'B', rh: '+' });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.flagged).toBe(true);

    const [beforeMatch] = await db.query(
      `SELECT verification_status, verified_by FROM lab_results
       WHERE donation_id = ? AND test_type = 'ABO_RH'`,
      [safeDonationId]
    );
    expect(beforeMatch[0]).toMatchObject({ verification_status: 'MISMATCH', verified_by: null });

    const match = await request(app)
      .post(`/api/lab/donations/${safeDonationId}/blood-group/verify`)
      .set(authHeaderForUser(4, 'LAB_TECH'))
      .send({ aboGroup: 'A', rh: '+' });
    expect(match.status).toBe(200);
    expect(match.body.verificationStatus).toBe('VERIFIED');

    const [units] = await db.query(
      'SELECT blood_group, status FROM blood_units WHERE donation_id = ?',
      [safeDonationId]
    );
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ blood_group: 'A+', status: 'QUARANTINE' });

    const lockedEdit = await request(app)
      .post(`/api/lab/donations/${safeDonationId}/blood-group`).set(authHeader('LAB_TECH'))
      .send({ aboGroup: 'O', rh: '-' });
    expect(lockedEdit.status).toBe(409);
  });

  it('requires all five non-reactive TTI results before availability and excludes quarantine', async () => {
    const inventoryBeforeScreening = await request(app)
      .get('/api/inventory').set(authHeader('MANAGER'));
    expect(inventoryBeforeScreening.status).toBe(200);
    expect(inventoryBeforeScreening.body.units.map((unit) => unit.unit_code)).not.toContain(safeUnitCode);
    expect(inventoryBeforeScreening.body.units.map((unit) => unit.unit_code)).not.toContain(
      (await db.query('SELECT unit_code FROM blood_units WHERE donation_id = ?', [untouchedDonationId]))[0][0].unit_code
    );

    for (const testType of ['HIV', 'HBV', 'HCV', 'SYPHILIS']) {
      expect((await recordTti(safeDonationId, testType)).status).toBe(201);
    }

    let [units] = await db.query('SELECT status FROM blood_units WHERE donation_id = ?', [safeDonationId]);
    expect(units[0].status).toBe('QUARANTINE');

    expect((await recordTti(safeDonationId, 'MALARIA')).status).toBe(201);
    [units] = await db.query('SELECT status FROM blood_units WHERE donation_id = ?', [safeDonationId]);
    expect(units[0].status).toBe('AVAILABLE');

    const inventory = await request(app).get('/api/inventory').set(authHeader('MANAGER'));
    expect(inventory.body.units.map((unit) => unit.unit_code)).toContain(safeUnitCode);
  });

  it('discards any reactive unit, flags its donor, creates staff-only notifications, and never restores it', async () => {
    const reactive = await recordTti(reactiveDonationId, 'HIV', 'REACTIVE');
    expect(reactive.status).toBe(201);
    expect(reactive.body.status).toBe('DISCARDED');

    const [rows] = await db.query(
      `SELECT bu.status, bu.discard_reason, d.follow_up_required, d.eligibility_status
       FROM blood_units bu JOIN donations dn ON dn.id = bu.donation_id
       JOIN donors d ON d.id = dn.donor_id WHERE dn.id = ?`,
      [reactiveDonationId]
    );
    expect(rows[0]).toMatchObject({
      status: 'DISCARDED',
      discard_reason: 'Reactive TTI: HIV',
      follow_up_required: 1,
      eligibility_status: 'DEFERRED',
    });

    const notifications = await request(app)
      .get('/api/lab/notifications').set(authHeader('ADMIN'));
    expect(notifications.status).toBe(200);
    expect(notifications.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'REACTIVE_TTI', entity_id: reactiveUnitCode }),
      ])
    );

    for (const testType of ['HBV', 'HCV', 'SYPHILIS', 'MALARIA']) {
      expect((await recordTti(reactiveDonationId, testType)).status).toBe(201);
    }
    const [after] = await db.query('SELECT status FROM blood_units WHERE donation_id = ?', [reactiveDonationId]);
    expect(after[0].status).toBe('DISCARDED');

    const inventory = await request(app).get('/api/inventory').set(authHeader('MANAGER'));
    expect(inventory.body.units.map((unit) => unit.unit_code)).not.toContain(reactiveUnitCode);
  });
});
