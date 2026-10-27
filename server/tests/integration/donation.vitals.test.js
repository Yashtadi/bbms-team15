const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

const NORMAL_VITALS = { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, hemoglobinGDl: 13.5 };

describe('TC-Don-02: capture pre/post-donation vitals (integration)', () => {
  let donationId;

  function recordVitals(phase, body, role = 'LAB_TECH', id = donationId) {
    return request(app).put(`/api/donations/${id}/vitals/${phase}`).set(authHeader(role)).send(body);
  }

  async function loadDonation() {
    const [rows] = await db.query('SELECT * FROM donations WHERE id = ?', [donationId]);
    return rows[0];
  }

  beforeAll(async () => {
    // An eligible, consented donor with a fresh donation session (F-010)
    const registered = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: 'Vitals Donor',
        age: 30,
        gender: 'MALE',
        contact: '9888777666',
        idProof: `ID-VITALS-${Date.now()}`,
        consentGiven: true,
      });
    expect(registered.status).toBe(201);

    const screened = await request(app)
      .post(`/api/donors/${registered.body.donorId}/eligibility`).set(authHeader('LAB_TECH'))
      .send({ weight: 70, hemoglobin: 14 });
    expect(screened.status).toBe(200);

    const session = await request(app)
      .post('/api/donations').set(authHeader('LAB_TECH'))
      .send({ donorId: registered.body.donorId, volumeMl: 450 });
    expect(session.status).toBe(201);
    donationId = session.body.donationId;
  });

  afterAll(async () => {
    await db.end();
  });

  it('stores pre-donation BP, pulse and haemoglobin against the session (AC 1 & AC 2)', async () => {
    const res = await recordVitals('pre', NORMAL_VITALS);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ donationId, phase: 'PRE', vitals: NORMAL_VITALS, warnings: [] });

    const donation = await loadDonation();
    expect(donation.bp_systolic).toBe(120);
    expect(donation.bp_diastolic).toBe(80);
    expect(donation.pulse_bpm).toBe(72);
    expect(Number(donation.hemoglobin_g_dl)).toBe(13.5);
  });

  it('stores post-donation vitals in the post columns without touching the pre ones (AC 1 & AC 2)', async () => {
    const post = { bpSystolic: 112, bpDiastolic: 74, pulseBpm: 84, hemoglobinGDl: '12.9' };
    const res = await recordVitals('post', post);

    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('POST');
    expect(res.body.vitals.hemoglobinGDl).toBe(12.9);
    // A post-donation haemoglobin drop below 12.5 is not flagged; 12.9 is fine either way
    expect(res.body.warnings).toEqual([]);

    const donation = await loadDonation();
    expect(donation.post_bp_systolic).toBe(112);
    expect(donation.post_bp_diastolic).toBe(74);
    expect(donation.post_pulse_bpm).toBe(84);
    expect(Number(donation.post_hemoglobin_g_dl)).toBe(12.9);
    expect(donation.bp_systolic).toBe(120);
    expect(Number(donation.hemoglobin_g_dl)).toBe(13.5);
  });

  it('stores out-of-safe-range readings and flags each one with a warning (AC 3)', async () => {
    const res = await recordVitals('pre', { bpSystolic: 141, bpDiastolic: 80, pulseBpm: 59, hemoglobinGDl: 12.4 });

    expect(res.status).toBe(200);
    expect(res.body.warnings.map((w) => w.field)).toEqual(['bpSystolic', 'pulseBpm', 'hemoglobinGDl']);
    res.body.warnings.forEach((w) => expect(w.message).toEqual(expect.any(String)));

    const donation = await loadDonation();
    expect(donation.bp_systolic).toBe(141);
    expect(donation.pulse_bpm).toBe(59);
    expect(Number(donation.hemoglobin_g_dl)).toBe(12.4);
  });

  it('does not flag low post-donation haemoglobin, but flags other post readings', async () => {
    const res = await recordVitals('post', { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 101, hemoglobinGDl: 11.8 });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([expect.objectContaining({ field: 'pulseBpm', value: 101 })]);
  });

  it.each([
    ['negative', { ...NORMAL_VITALS, bpSystolic: -120 }, 'bpSystolic'],
    ['non-numeric', { ...NORMAL_VITALS, hemoglobinGDl: 'abc' }, 'hemoglobinGDl'],
    ['missing', { bpSystolic: 120, bpDiastolic: 80, hemoglobinGDl: 13.5 }, 'pulseBpm'],
  ])('rejects a %s value with 400 and leaves the session unchanged (AC 4)', async (_label, body, field) => {
    const before = await loadDonation();

    const res = await recordVitals('pre', body);

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty(field);
    expect(await loadDonation()).toEqual(before);
  });

  it('unknown donation → 404', async () => {
    const res = await recordVitals('pre', NORMAL_VITALS, 'LAB_TECH', 999999);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Donation not found');
  });

  it.each(['ADMIN', 'MANAGER', 'HOSPITAL', 'DONOR'])('%s role → 403', async (role) => {
    const res = await recordVitals('pre', NORMAL_VITALS, role);

    expect(res.status).toBe(403);
  });

  it('no token → 401', async () => {
    const res = await request(app).put(`/api/donations/${donationId}/vitals/pre`).send(NORMAL_VITALS);

    expect(res.status).toBe(401);
  });
});
