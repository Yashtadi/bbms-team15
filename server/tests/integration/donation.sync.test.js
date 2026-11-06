const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

const DAY_MS = 24 * 60 * 60 * 1000;
const LAB_TECH_USER_ID = 3; // seed.sql
const DEFERRED_SEED_DONOR = 'D-000003'; // seed.sql: deferred after a reactive TTI

describe('TC-Don-04: offline camp recording + sync (integration)', () => {
  const timestamp = Date.now();
  let donorCount = 0;

  async function registerDonor({ consentGiven = true, screen = true } = {}) {
    donorCount += 1;
    const res = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: `Camp Sync Donor ${donorCount}`,
        age: 30,
        gender: 'MALE',
        contact: '9888777444',
        idProof: `ID-CAMP-${donorCount}-${timestamp}`,
        consentGiven,
      });
    expect(res.status).toBe(201);
    if (screen) {
      const screened = await request(app)
        .post(`/api/donors/${res.body.donorId}/eligibility`).set(authHeader('LAB_TECH'))
        .send({ weight: 70, hemoglobin: 14 });
      expect(screened.status).toBe(200);
    }
    return res.body.donorId;
  }

  // MySQL DATETIME keeps whole seconds, so test times have no milliseconds
  function hoursAgo(hours) {
    const date = new Date(Date.now() - hours * 60 * 60 * 1000);
    date.setMilliseconds(0);
    return date;
  }

  function campRecord(donorId, overrides = {}) {
    return {
      clientRef: crypto.randomUUID(),
      donorId,
      campLocation: 'Jayanagar community hall camp',
      collectedAt: hoursAgo(3).toISOString(),
      donationType: 'WHOLE_BLOOD',
      volumeMl: 450,
      vitals: { bpSystolic: 118, bpDiastolic: 78, pulseBpm: 70, hemoglobinGDl: 13.8 },
      ...overrides,
    };
  }

  function sync(records, role = 'LAB_TECH') {
    return request(app).post('/api/donations/sync').set(authHeader(role)).send({ records });
  }

  async function donationsWithRef(clientRef) {
    const [rows] = await db.query('SELECT * FROM donations WHERE client_ref = ?', [clientRef]);
    return rows;
  }

  afterAll(async () => {
    await db.end();
  });

  it('saves a normal batch with camp location, original collection time and a QUARANTINE unit', async () => {
    const records = [campRecord(await registerDonor()), campRecord(await registerDonor())];

    const res = await sync(records);

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ created: 2, alreadySynced: 0, rejected: 0, failed: 0 });
    expect(res.body.results.map((r) => r.status)).toEqual([201, 201]);

    for (const [index, record] of records.entries()) {
      const result = res.body.results[index];
      expect(result.clientRef).toBe(record.clientRef);
      expect(result.unit.unitId).toMatch(/^U-\d{4}-\d{6,}$/);

      const [donation] = await donationsWithRef(record.clientRef);
      expect(donation.id).toBe(result.donationId);
      expect(donation.camp_location).toBe('Jayanagar community hall camp');
      expect(donation.collected_by).toBe(LAB_TECH_USER_ID);
      expect(donation.status).toBe('COMPLETED');
      expect(new Date(donation.collected_at).toISOString()).toBe(record.collectedAt);
      expect(Number(donation.hemoglobin_g_dl)).toBe(13.8);
      expect(donation.bp_systolic).toBe(118);

      const [units] = await db.query('SELECT * FROM blood_units WHERE donation_id = ?', [donation.id]);
      expect(units).toHaveLength(1);
      expect(units[0].unit_code).toBe(result.unit.unitId);
      expect(units[0].status).toBe('QUARANTINE');
      expect(new Date(units[0].expires_at).getTime())
        .toBe(new Date(record.collectedAt).getTime() + 35 * DAY_MS);

      const [audit] = await db.query(
        "SELECT * FROM audit_log WHERE action = 'DONATION_SYNCED' AND entity_id = ?",
        [units[0].unit_code]
      );
      expect(audit).toHaveLength(1);
    }
  });

  it('replaying the same clientRef returns the existing donation (200) and creates no duplicate', async () => {
    const record = campRecord(await registerDonor());

    const first = await sync([record]);
    expect(first.body.results[0].status).toBe(201);

    const replay = await sync([record, record]);

    expect(replay.status).toBe(200);
    expect(replay.body.summary).toEqual({ created: 0, alreadySynced: 2, rejected: 0, failed: 0 });
    replay.body.results.forEach((result) => {
      expect(result).toEqual(expect.objectContaining({
        status: 200,
        outcome: 'ALREADY_SYNCED',
        donationId: first.body.results[0].donationId,
      }));
      expect(result.unit.unitId).toBe(first.body.results[0].unit.unitId);
    });
    expect(await donationsWithRef(record.clientRef)).toHaveLength(1);
  });

  it('handles a mixed batch: valid saved, deferred donor 422, bad vitals 400', async () => {
    const valid = campRecord(await registerDonor());
    const deferred = campRecord(DEFERRED_SEED_DONOR);
    const badVitals = campRecord(await registerDonor(), {
      vitals: { bpSystolic: 120, bpDiastolic: 80, pulseBpm: -5, hemoglobinGDl: 13.5 },
    });

    const res = await sync([valid, deferred, badVitals]);

    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => r.status)).toEqual([201, 422, 400]);
    expect(res.body.results[1].code).toBe('DONOR_NOT_ELIGIBLE');
    expect(res.body.results[2].errors.pulseBpm).toBeDefined();
    expect(await donationsWithRef(valid.clientRef)).toHaveLength(1);
    expect(await donationsWithRef(deferred.clientRef)).toHaveLength(0);
    expect(await donationsWithRef(badVitals.clientRef)).toHaveLength(0);
  });

  it('rejects a future collectedAt with a per-record 400 and saves nothing', async () => {
    const future = new Date(Date.now() + DAY_MS);
    future.setMilliseconds(0);
    const record = campRecord(await registerDonor(), { collectedAt: future.toISOString() });

    const res = await sync([record]);

    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe(400);
    expect(res.body.results[0].errors.collectedAt).toMatch(/future/);
    expect(await donationsWithRef(record.clientRef)).toHaveLength(0);
  });

  it('rejects an unknown donor with a per-record 404', async () => {
    const res = await sync([campRecord('D-999999')]);
    expect(res.body.results[0]).toEqual(expect.objectContaining({ status: 404, code: 'DONOR_NOT_FOUND' }));
  });

  it('promotes a PENDING donor to ELIGIBLE when the camp vitals pass', async () => {
    const donorId = await registerDonor({ screen: false });

    const res = await sync([campRecord(donorId)]);

    expect(res.body.results[0].status).toBe(201);
    const [rows] = await db.query('SELECT eligibility_status FROM donors WHERE donor_code = ?', [donorId]);
    expect(rows[0].eligibility_status).toBe('ELIGIBLE');
  });

  it('rejects a second camp donation by the same donor within 90 days (422)', async () => {
    const donorId = await registerDonor();
    const first = campRecord(donorId, { collectedAt: hoursAgo(5).toISOString() });
    const second = campRecord(donorId, { collectedAt: hoursAgo(2).toISOString() });

    const res = await sync([first, second]);

    expect(res.body.results.map((r) => r.status)).toEqual([201, 422]);
    expect(res.body.results[1].message).toMatch(/90 days/);
  });

  it('rejects a batch over 50 records with 400 for the whole request', async () => {
    const records = Array.from({ length: 51 }, () => campRecord('D-000001'));

    const res = await sync(records);

    expect(res.status).toBe(400);
    expect(res.body.errors.records).toMatch(/50/);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/donations/sync').send({ records: [campRecord('D-000001')] });
    expect(res.status).toBe(401);
  });

  it.each(['HOSPITAL', 'DONOR'])('returns 403 for the %s role and saves nothing', async (role) => {
    const record = campRecord('D-000001');

    const res = await sync([record], role);

    expect(res.status).toBe(403);
    expect(await donationsWithRef(record.clientRef)).toHaveLength(0);
  });
});
