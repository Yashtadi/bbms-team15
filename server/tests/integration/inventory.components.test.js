const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader, authHeaderForUser } = require('../helpers/auth');

const DAY_MS = 24 * 60 * 60 * 1000;
const TTI_TESTS = ['HIV', 'HBV', 'HCV', 'SYPHILIS', 'MALARIA'];

describe('TC-Inv-02: track blood components (integration)', () => {
  let donorCount = 0;

  async function registerEligibleDonor() {
    donorCount += 1;
    const donor = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: `Component Donor ${donorCount}`,
        age: 30,
        gender: 'MALE',
        contact: '9888777333',
        idProof: `ID-COMP-${donorCount}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        consentGiven: true,
      });
    expect(donor.status).toBe(201);
    const screened = await request(app)
      .post(`/api/donors/${donor.body.donorId}/eligibility`).set(authHeader('LAB_TECH'))
      .send({ weight: 70, hemoglobin: 14 });
    expect(screened.status).toBe(200);
    return donor.body.donorId;
  }

  // A fresh whole-blood (or apheresis) donation; its unit starts in QUARANTINE
  async function createDonation(donationType = 'WHOLE_BLOOD') {
    const donorId = await registerEligibleDonor();
    const session = await request(app)
      .post('/api/donations').set(authHeader('LAB_TECH'))
      .send({ donorId, volumeMl: 450, donationType });
    expect(session.status).toBe(201);
    return { donationId: session.body.donationId, unitCode: session.body.unit.unitId };
  }

  // A whole-blood donation collected some time ago, recorded through the F-013 camp sync
  async function createOldDonation(ageMs) {
    const donorId = await registerEligibleDonor();
    const collectedAt = new Date(Date.now() - ageMs);
    collectedAt.setMilliseconds(0);
    const res = await request(app)
      .post('/api/donations/sync').set(authHeader('LAB_TECH'))
      .send({
        records: [{
          clientRef: crypto.randomUUID(),
          donorId,
          campLocation: 'Component test camp',
          collectedAt: collectedAt.toISOString(),
          donationType: 'WHOLE_BLOOD',
          volumeMl: 450,
          vitals: { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, hemoglobinGDl: 14 },
        }],
      });
    expect(res.body.results[0].status).toBe(201);
    return { donationId: res.body.results[0].donationId, unitCode: res.body.results[0].unit.unitId, collectedAt };
  }

  function separate(unitCode, components = ['PRBC', 'FFP', 'PLATELETS'], role = 'LAB_TECH') {
    return request(app)
      .post(`/api/inventory/units/${unitCode}/separate`).set(authHeader(role))
      .send({ components });
  }

  // F-020 two-person ABO/Rh check, then all five TTI tests (F-021).
  // Uses groups the seed and other test files don't count on (A-, B-), because the DB is shared.
  async function screenDonation(donationId, { aboGroup = 'A', rh = '-', reactive = null } = {}) {
    const entered = await request(app)
      .post(`/api/lab/donations/${donationId}/blood-group`).set(authHeader('LAB_TECH'))
      .send({ aboGroup, rh });
    expect(entered.status).toBe(201);
    const verified = await request(app)
      .post(`/api/lab/donations/${donationId}/blood-group/verify`).set(authHeaderForUser(4, 'LAB_TECH'))
      .send({ aboGroup, rh });
    expect(verified.status).toBe(200);

    for (const testType of TTI_TESTS) {
      const res = await request(app)
        .post(`/api/lab/donations/${donationId}/tti-results`).set(authHeader('LAB_TECH'))
        .send({ testType, result: testType === reactive ? 'REACTIVE' : 'NON_REACTIVE', method: 'ELISA' });
      expect(res.status).toBe(201);
    }
  }

  async function unitsOfDonation(donationId) {
    const [rows] = await db.query(
      'SELECT * FROM blood_units WHERE donation_id = ? ORDER BY id ASC',
      [donationId]
    );
    return rows;
  }

  async function labQueue() {
    const res = await request(app).get('/api/lab/queue').set(authHeader('LAB_TECH'));
    expect(res.status).toBe(200);
    return res.body.queue;
  }

  async function summaryCount(bloodGroup, component) {
    const res = await request(app).get('/api/inventory/summary').set(authHeader('MANAGER'));
    expect(res.status).toBe(200);
    const entry = res.body.stock.find((s) => s.bloodGroup === bloodGroup && s.component === component);
    return { units: entry ? entry.units : 0, total: res.body.totals.units };
  }

  afterAll(async () => {
    await db.end();
  });

  it('separates a QUARANTINE whole-blood unit into linked components with their own codes', async () => {
    const { donationId, unitCode } = await createDonation();

    const res = await separate(unitCode, ['PRBC', 'FFP', 'PLATELETS', 'CRYO']);

    expect(res.status).toBe(201);
    expect(res.body.parent).toEqual(expect.objectContaining({ unitId: unitCode, status: 'SEPARATED' }));
    expect(res.body.children.map((c) => c.component)).toEqual(['PRBC', 'FFP', 'PLATELETS', 'CRYO']);

    const [parent, ...children] = await unitsOfDonation(donationId);
    expect(parent.unit_code).toBe(unitCode);
    expect(parent.status).toBe('SEPARATED');
    expect(children).toHaveLength(4);
    const shelfLife = { PRBC: 42, FFP: 365, PLATELETS: 5, CRYO: 365 };
    children.forEach((child, i) => {
      expect(child.unit_code).toBe(res.body.children[i].unitId);
      expect(child.unit_code).toMatch(/^U-\d{4}-\d{6,}$/);
      expect(child.parent_unit_id).toBe(parent.id);
      expect(child.donation_id).toBe(donationId);
      expect(child.status).toBe('QUARANTINE');
      expect(new Date(child.collected_at).getTime()).toBe(new Date(parent.collected_at).getTime());
      expect(new Date(child.expires_at).getTime())
        .toBe(new Date(parent.collected_at).getTime() + shelfLife[child.component] * DAY_MS);
    });

    const [audit] = await db.query(
      "SELECT action FROM audit_log WHERE action IN ('UNIT_SEPARATED', 'COMPONENT_CREATED') AND entity_id IN (?)",
      [[unitCode, ...children.map((c) => c.unit_code)]]
    );
    expect(audit.map((a) => a.action).sort()).toEqual(
      ['COMPONENT_CREATED', 'COMPONENT_CREATED', 'COMPONENT_CREATED', 'COMPONENT_CREATED', 'UNIT_SEPARATED']
    );

    // The barcode lookup (F-012) shows the parent on a component
    const lookup = await request(app).get(`/api/donations/units/${children[0].unit_code}`).set(authHeader('LAB_TECH'));
    expect(lookup.body.parentUnitCode).toBe(unitCode);
  });

  it('refuses to separate the same unit twice (409) and creates nothing more', async () => {
    const { donationId, unitCode } = await createDonation();
    expect((await separate(unitCode)).status).toBe(201);

    const again = await separate(unitCode);

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_SEPARATED');
    expect(await unitsOfDonation(donationId)).toHaveLength(4);
  });

  it('refuses non-whole-blood units with 422: a component and an apheresis unit', async () => {
    const { unitCode } = await createDonation();
    const first = await separate(unitCode, ['PRBC']);
    const component = await separate(first.body.children[0].unitId, ['FFP']);
    expect(component.status).toBe(422);
    expect(component.body.code).toBe('NOT_WHOLE_BLOOD');

    const apheresis = await createDonation('APHERESIS');
    const res = await separate(apheresis.unitCode, ['PLATELETS']);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NOT_WHOLE_BLOOD');
  });

  it('returns 404 for an unknown unit and 400 for a bad code or component list', async () => {
    expect((await separate('U-2026-999999')).status).toBe(404);

    const badCode = await separate('BAG-7');
    expect(badCode.status).toBe(400);
    expect(badCode.body.errors.unitCode).toBeDefined();

    const { unitCode } = await createDonation();
    const badComponents = await separate(unitCode, ['PRBC', 'PLASMA']);
    expect(badComponents.status).toBe(400);
    expect(badComponents.body.errors.components).toBeDefined();
  });

  it('returns 401 without a token and 403 for HOSPITAL and DONOR on both routes', async () => {
    const { unitCode } = await createDonation();

    const noToken = await request(app).post(`/api/inventory/units/${unitCode}/separate`).send({ components: ['PRBC'] });
    expect(noToken.status).toBe(401);
    expect((await request(app).get(`/api/inventory/units/${unitCode}/lineage`)).status).toBe(401);

    for (const role of ['HOSPITAL', 'DONOR']) {
      expect((await separate(unitCode, ['PRBC'], role)).status).toBe(403);
      const lineage = await request(app).get(`/api/inventory/units/${unitCode}/lineage`).set(authHeader(role));
      expect(lineage.status).toBe(403);
    }
    const [[unit]] = await db.query('SELECT status FROM blood_units WHERE unit_code = ?', [unitCode]);
    expect(unit.status).toBe('QUARANTINE');
  });

  it('traces a component to its parent, siblings and donation (lineage)', async () => {
    const { donationId, unitCode } = await createDonation();
    const { body } = await separate(unitCode, ['PRBC', 'FFP', 'PLATELETS']);
    const [prbc, ffp, platelets] = body.children.map((c) => c.unitId);

    const ofChild = await request(app).get(`/api/inventory/units/${ffp}/lineage`).set(authHeader('MANAGER'));
    expect(ofChild.status).toBe(200);
    expect(ofChild.body.unit).toEqual(expect.objectContaining({ unitId: ffp, parentUnitCode: unitCode }));
    expect(ofChild.body.parent.unitId).toBe(unitCode);
    expect(ofChild.body.siblings.map((s) => s.unitId)).toEqual([prbc, platelets]);
    expect(ofChild.body.children).toEqual([]);
    expect(ofChild.body.donation).toEqual(expect.objectContaining({ donationId, donationType: 'WHOLE_BLOOD' }));
    expect(ofChild.body.donation.donorCode).toMatch(/^D-\d{6,}$/);

    const ofParent = await request(app).get(`/api/inventory/units/${unitCode}/lineage`).set(authHeader('LAB_TECH'));
    expect(ofParent.body.parent).toBeNull();
    expect(ofParent.body.children.map((c) => c.unitId)).toEqual([prbc, ffp, platelets]);
  });

  it('counts platelet expiry from collection: day 4 after collection is allowed and expires on day 5', async () => {
    const { unitCode, collectedAt } = await createOldDonation(4 * DAY_MS);

    const res = await separate(unitCode, ['PLATELETS', 'PRBC']);

    expect(res.status).toBe(201);
    expect(new Date(res.body.children[0].expiresAt).getTime()).toBe(collectedAt.getTime() + 5 * DAY_MS);
    expect(new Date(res.body.children[1].expiresAt).getTime()).toBe(collectedAt.getTime() + 42 * DAY_MS);
  });

  it('refuses platelets from a bag collected more than 5 days ago (422) and leaves the bag as it was', async () => {
    const { unitCode } = await createOldDonation(5 * DAY_MS + 60 * 60 * 1000);

    const res = await separate(unitCode, ['PRBC', 'PLATELETS']);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('COMPONENT_EXPIRED');
    const [[unit]] = await db.query('SELECT status FROM blood_units WHERE unit_code = ?', [unitCode]);
    expect(unit.status).toBe('QUARANTINE');
    const [children] = await db.query(
      'SELECT id FROM blood_units WHERE parent_unit_id = (SELECT id FROM blood_units WHERE unit_code = ?)',
      [unitCode]
    );
    expect(children).toHaveLength(0);
  });

  it('releases every component when the separated donation passes ABO/Rh and all 5 TTI tests', async () => {
    const { donationId, unitCode } = await createDonation();
    const { body } = await separate(unitCode, ['PRBC', 'FFP', 'PLATELETS']);
    const childCodes = body.children.map((c) => c.unitId);

    await screenDonation(donationId, { aboGroup: 'A', rh: '-' });

    const [parent, ...children] = await unitsOfDonation(donationId);
    expect(parent.status).toBe('SEPARATED');
    expect(children).toHaveLength(3);
    children.forEach((child) => {
      expect(child.status).toBe('AVAILABLE');
      expect(child.blood_group).toBe('A-');
    });

    const inventory = await request(app).get('/api/inventory').set(authHeader('MANAGER'));
    const listed = inventory.body.units.map((u) => u.unit_code);
    expect(listed).toEqual(expect.arrayContaining(childCodes));
    expect(listed).not.toContain(unitCode);
  });

  it('discards every component on a reactive TTI, keeps the parent SEPARATED and alerts each staff member once', async () => {
    const { donationId, unitCode } = await createDonation();
    const { body } = await separate(unitCode, ['PRBC', 'FFP', 'PLATELETS']);
    const codes = [unitCode, ...body.children.map((c) => c.unitId)];

    await screenDonation(donationId, { aboGroup: 'B', rh: '+', reactive: 'HCV' });

    const [parent, ...children] = await unitsOfDonation(donationId);
    expect(parent.status).toBe('SEPARATED');
    children.forEach((child) => {
      expect(child.status).toBe('DISCARDED');
      expect(child.discard_reason).toBe('Reactive TTI: HCV');
    });

    const [[{ staff }]] = await db.query(
      "SELECT COUNT(*) AS staff FROM users WHERE is_active = TRUE AND role IN ('LAB_TECH', 'MANAGER', 'ADMIN')"
    );
    const [alerts] = await db.query(
      `SELECT recipient_user_id, COUNT(*) AS n, MIN(entity_id) AS entity_id FROM notifications
       WHERE event_type = 'REACTIVE_TTI' AND entity_id IN (?)
       GROUP BY recipient_user_id`,
      [codes]
    );
    expect(alerts).toHaveLength(Number(staff));
    alerts.forEach((alert) => {
      expect(Number(alert.n)).toBe(1);
      expect(alert.entity_id).toBe(unitCode);
    });
  });

  it('shows a separated donation as ONE queue ticket listing its components, keeping FIFO order', async () => {
    const before = await createDonation();
    const separated = await createDonation();
    const after = await createDonation();
    const { body } = await separate(separated.unitCode, ['PRBC', 'FFP', 'PLATELETS', 'CRYO']);
    const childCodes = body.children.map((c) => c.unitId);

    const queue = await labQueue();

    const tickets = queue.filter((t) => t.donationId === separated.donationId);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toEqual(expect.objectContaining({
      unitCode: separated.unitCode,
      unitStatus: 'QUARANTINE',
      isSeparated: true,
    }));
    expect(tickets[0].unitCodes).toEqual(childCodes);
    expect(tickets[0].components.map((c) => c.component)).toEqual(['PRBC', 'FFP', 'PLATELETS', 'CRYO']);

    // Unseparated donations still get one ticket each, and the order is still FIFO
    const ours = queue
      .filter((t) => [before.donationId, separated.donationId, after.donationId].includes(t.donationId))
      .map((t) => t.donationId);
    expect(ours).toEqual([before.donationId, separated.donationId, after.donationId]);
    expect(new Set(queue.map((t) => t.donationId)).size).toBe(queue.length);
    for (let i = 1; i < queue.length; i += 1) {
      const prev = new Date(queue[i - 1].collectedAt).getTime();
      const curr = new Date(queue[i].collectedAt).getTime();
      expect(prev < curr || (prev === curr && queue[i - 1].donationId < queue[i].donationId)).toBe(true);
    }
  });

  it('F-030 summary counts the components and never the separated parent', async () => {
    const { donationId, unitCode } = await createDonation();
    await screenDonation(donationId, { aboGroup: 'B', rh: '-' });

    const wbBefore = await summaryCount('B-', 'WHOLE_BLOOD');
    const prbcBefore = await summaryCount('B-', 'PRBC');
    const ffpBefore = await summaryCount('B-', 'FFP');

    expect((await separate(unitCode, ['PRBC', 'FFP'])).status).toBe(201);

    const wbAfter = await summaryCount('B-', 'WHOLE_BLOOD');
    const prbcAfter = await summaryCount('B-', 'PRBC');
    const ffpAfter = await summaryCount('B-', 'FFP');
    expect(wbAfter.units).toBe(wbBefore.units - 1);
    expect(prbcAfter.units).toBe(prbcBefore.units + 1);
    expect(ffpAfter.units).toBe(ffpBefore.units + 1);
    // One bag out, two components in
    expect(ffpAfter.total).toBe(wbBefore.total + 1);
  });
});
