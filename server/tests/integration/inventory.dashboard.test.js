const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader, authHeaderForUser } = require('../helpers/auth');

// TC-Inv-01 / AC-BBMS-F-030: the inventory dashboard reflects stock changes
// within 5 seconds of any transaction.
describe('TC-Inv-01: real-time inventory dashboard summary', () => {
  const BLOOD_GROUP = { aboGroup: 'AB', rh: '-' };
  const GROUP_LABEL = 'AB-';
  const COMPONENT = 'WHOLE_BLOOD'; // a whole-blood donation creates one WHOLE_BLOOD unit

  async function createDonation(label) {
    const donor = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: `Inventory ${label} Donor`,
        age: 30,
        gender: 'MALE',
        contact: '9888777555',
        idProof: `ID-INV-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
    return session.body.donationId;
  }

  async function verifyBloodGroup(donationId) {
    const entered = await request(app)
      .post(`/api/lab/donations/${donationId}/blood-group`).set(authHeader('LAB_TECH'))
      .send(BLOOD_GROUP);
    expect(entered.status).toBe(201);
    const verified = await request(app)
      .post(`/api/lab/donations/${donationId}/blood-group/verify`)
      .set(authHeaderForUser(4, 'LAB_TECH')) // second technician (seed user 4)
      .send(BLOOD_GROUP);
    expect(verified.status).toBe(200);
  }

  async function recordTti(donationId, testType, result = 'NON_REACTIVE') {
    const response = await request(app)
      .post(`/api/lab/donations/${donationId}/tti-results`).set(authHeader('LAB_TECH'))
      .send({ testType, result, method: 'ELISA' });
    expect(response.status).toBe(201);
  }

  async function summary() {
    const response = await request(app).get('/api/inventory/summary').set(authHeader('MANAGER'));
    expect(response.status).toBe(200);
    return response.body;
  }

  function unitsFor(body) {
    const entry = body.stock.find((s) => s.bloodGroup === GROUP_LABEL && s.component === COMPONENT);
    return entry ? entry.units : 0;
  }

  afterAll(async () => {
    await db.end();
  });

  it('counts seed stock by blood group and component and matches the unit list', async () => {
    const body = await summary();
    const list = await request(app).get('/api/inventory').set(authHeader('MANAGER'));

    expect(body.totals.units).toBe(list.body.units.length);
    expect(body.stock).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bloodGroup: 'O-', component: 'PRBC' }),
        expect.objectContaining({ bloodGroup: 'A+', component: 'FFP' }),
      ])
    );
    // Seed unit 3 is EXPIRED and unit 6 is DISCARDED: neither may appear as O- PLATELETS / B+ WHOLE_BLOOD
    expect(body.stock).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ bloodGroup: 'O-', component: 'PLATELETS' })])
    );
    expect(body.stock).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ bloodGroup: 'B+', component: 'WHOLE_BLOOD' })])
    );
  });

  it('shows a newly released unit within 5 seconds, and never while it is in quarantine', async () => {
    const before = unitsFor(await summary());
    const donationId = await createDonation('RELEASE');
    await verifyBloodGroup(donationId);
    for (const testType of ['HIV', 'HBV', 'HCV', 'SYPHILIS']) {
      await recordTti(donationId, testType);
    }

    // Still in quarantine: 4 of 5 tests done, so the count must not change
    expect(unitsFor(await summary())).toBe(before);

    // The transaction: the last negative result releases the unit
    await recordTti(donationId, 'MALARIA');
    const releasedAt = Date.now();

    const after = await summary();
    expect(unitsFor(after)).toBe(before + 1);
    expect(Date.now() - releasedAt).toBeLessThan(5000);
    expect(new Date(after.generatedAt).getTime()).toBeGreaterThanOrEqual(releasedAt - 1000);
  });

  it('never counts a unit that is discarded after a reactive result', async () => {
    const before = unitsFor(await summary());
    const donationId = await createDonation('REACTIVE');
    await verifyBloodGroup(donationId);
    await recordTti(donationId, 'HIV', 'REACTIVE');
    for (const testType of ['HBV', 'HCV', 'SYPHILIS', 'MALARIA']) {
      await recordTti(donationId, testType);
    }

    expect(unitsFor(await summary())).toBe(before);
  });
});
