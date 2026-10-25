const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');

describe('TC-Reg-02: eligibility API (integration)', () => {
  afterAll(async () => {
    await db.end();
  });

  describe('POST /api/donors/eligibility', () => {
    it('returns 422 with the reason for an ineligible donor (underage 17)', async () => {
      const res = await request(app)
        .post('/api/donors/eligibility')
        .send({
          age: 17,
          weight: 55,
          hemoglobin: 13.5,
          daysSinceLastDonation: 100,
        });

      expect(res.status).toBe(422);
      expect(res.body.eligible).toBe(false);
      expect(res.body.status).toBe('DEFERRED');
      expect(res.body.reason).toContain('Donor age must be between 18 and 65');
    });

    it('returns 422 with the reason for an ineligible donor (weight below 45 kg)', async () => {
      const res = await request(app)
        .post('/api/donors/eligibility')
        .send({
          age: 24,
          weight: 44.5,
          hemoglobin: 13.5,
          daysSinceLastDonation: 100,
        });

      expect(res.status).toBe(422);
      expect(res.body.eligible).toBe(false);
      expect(res.body.reason).toContain('Weight must be at least 45 kg');
    });

    it('returns 422 with the reason for an ineligible donor (low haemoglobin < 12.5)', async () => {
      const res = await request(app)
        .post('/api/donors/eligibility')
        .send({
          age: 24,
          weight: 55,
          hemoglobin: 11.8,
          daysSinceLastDonation: 100,
        });

      expect(res.status).toBe(422);
      expect(res.body.eligible).toBe(false);
      expect(res.body.reason).toContain('Haemoglobin must be at least 12.5 g/dL');
    });

    it('returns 422 with the reason when donation gap is less than 90 days', async () => {
      const res = await request(app)
        .post('/api/donors/eligibility')
        .send({
          age: 28,
          weight: 65,
          hemoglobin: 14.2,
          daysSinceLastDonation: 45,
        });

      expect(res.status).toBe(422);
      expect(res.body.eligible).toBe(false);
      expect(res.body.reason).toContain('At least 90 days required since last donation');
    });

    it('returns 200 when all criteria are satisfied', async () => {
      const res = await request(app)
        .post('/api/donors/eligibility')
        .send({
          age: 25,
          weight: 62,
          hemoglobin: 13.8,
          daysSinceLastDonation: 95,
        });

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(true);
      expect(res.body.status).toBe('ELIGIBLE');
      expect(res.body.message).toContain('eligible to donate');
    });
  });

  describe('POST /api/donors/:id/eligibility', () => {
    it('returns 404 if donor does not exist', async () => {
      const res = await request(app)
        .post('/api/donors/999999/eligibility')
        .send({ weight: 60, hemoglobin: 13.5 });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Donor not found');
    });
  });
});
