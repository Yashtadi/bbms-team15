const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');

describe('TC-Reg-04: digital donor consent (integration)', () => {
  afterAll(async () => {
    await db.end();
  });

  const timestamp = Date.now();
  let createdDonorId = null;

  beforeAll(async () => {
    // Register a donor without consent
    const res = await request(app)
      .post('/api/donors')
      .send({
        name: 'Consent Integration Donor',
        age: 30,
        gender: 'MALE',
        contact: '9888777666',
        idProof: `ID-CONSENT-TEST-${timestamp}`,
        consentGiven: false,
      });

    expect(res.status).toBe(201);
    createdDonorId = res.body.donorId;
  });

  it('rejects attempting a donation without consent with 422 (AC 1 & AC 3)', async () => {
    const res = await request(app)
      .post('/api/donations')
      .send({
        donorId: createdDonorId,
        volumeMl: 450,
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
    expect(res.body.message).toContain('Consent must be captured before a donation can proceed');
  });

  it('digitally records consent with a timestamp linked to the donor ID (AC 2)', async () => {
    const res = await request(app)
      .post(`/api/donors/${createdDonorId}/consent`)
      .send({ consent: true });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('donorId', createdDonorId);
    expect(res.body).toHaveProperty('consentGiven', true);
    expect(res.body).toHaveProperty('consentAt');

    // Verify persisted directly in MySQL
    const [rows] = await db.query(
      'SELECT consent_given, consent_at FROM donors WHERE donor_code = ?',
      [createdDonorId]
    );

    expect(rows.length).toBe(1);
    expect(rows[0].consent_given).toBe(1);
    expect(rows[0].consent_at).not.toBeNull();
  });

  it('allows donation session once consent has been digitally captured (AC 1)', async () => {
    const res = await request(app)
      .post('/api/donations')
      .send({
        donorId: createdDonorId,
        volumeMl: 450,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('donationId');
    expect(res.body).toHaveProperty('status', 'IN_PROGRESS');
    expect(res.body).toHaveProperty('donorId', createdDonorId);

    // Verify row created in MySQL donations table
    const [rows] = await db.query('SELECT * FROM donations WHERE id = ?', [res.body.donationId]);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('IN_PROGRESS');
  });
});
