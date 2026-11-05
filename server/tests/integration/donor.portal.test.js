const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

const PASSWORD = 'Password@123'; // Seed password for donor@bbms.test

describe('Donor Portal & Account Provisioning (integration)', () => {
  afterAll(async () => {
    await db.end();
  });

  describe('GET /api/donors/portal/me', () => {
    it('returns 401 if unauthenticated', async () => {
      const res = await request(app).get('/api/donors/portal/me');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-DONOR non-ADMIN role (e.g. HOSPITAL)', async () => {
      const res = await request(app)
        .get('/api/donors/portal/me')
        .set(authHeader('HOSPITAL'));
      expect(res.status).toBe(403);
    });

    it('returns 200 with donor profile, statistics, and history for logged in DONOR', async () => {
      // Login as pre-seeded donor@bbms.test (user_id 6, donor D-000001)
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'donor@bbms.test', password: PASSWORD });

      expect(loginRes.status).toBe(200);
      const token = loginRes.body.token;

      const res = await request(app)
        .get('/api/donors/portal/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('donor');
      expect(res.body.donor).toMatchObject({
        donorCode: 'D-000001',
        fullName: 'Ravi Kumar',
        bloodGroup: 'O-',
      });
      expect(res.body.donor.maskedIdProof).toBe('ID-****01');

      expect(res.body).toHaveProperty('stats');
      expect(res.body.stats.totalDonations).toBeGreaterThanOrEqual(1);
      expect(res.body.stats.livesSaved).toBe(res.body.stats.totalDonations * 3);
      expect(res.body.stats).toHaveProperty('nextEligibleDate');

      expect(res.body).toHaveProperty('history');
      expect(Array.isArray(res.body.history)).toBe(true);
      expect(res.body.history.length).toBeGreaterThanOrEqual(1);
      expect(res.body.history[0]).toHaveProperty('volumeMl', 450);
      expect(res.body.history[0].vitals).toHaveProperty('hemoglobin');
    });
  });

  describe('Login with Donor ID (e.g. D-000001)', () => {
    it('allows logging in using donor code instead of email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'D-000001', password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        email: 'donor@bbms.test',
        fullName: 'Ravi Kumar',
        role: 'DONOR',
      });
    });
  });

  describe('POST /api/auth/change-password', () => {
    it('rejects with 401 when current password is incorrect', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'donor@bbms.test', password: PASSWORD });

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${loginRes.body.token}`)
        .send({
          currentPassword: 'WrongPassword999',
          newPassword: 'BrandNewPassword123',
          confirmPassword: 'BrandNewPassword123',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Current password is incorrect');
    });

    it('rejects with 400 when new passwords do not match', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'donor@bbms.test', password: PASSWORD });

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${loginRes.body.token}`)
        .send({
          currentPassword: PASSWORD,
          newPassword: 'BrandNewPassword123',
          confirmPassword: 'MismatchedPassword456',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('do not match');
    });
  });

  describe('Automatic user provisioning on donor registration', () => {
    it('provisions portal user with default DOB password and allows instant login', async () => {
      const testTimestamp = Date.now();
      const uniqueId = `PORTAL-ID-${testTimestamp}`;
      const uniquePhone = `91${String(testTimestamp).slice(-8)}`;

      // Register donor with DOB 1996-08-25 -> default password is 25081996
      const regRes = await request(app)
        .post('/api/donors')
        .set(authHeader('LAB_TECH'))
        .send({
          name: 'Walkin Portal Tester',
          dateOfBirth: '1996-08-25',
          gender: 'MALE',
          contact: uniquePhone,
          idProof: uniqueId,
          medicalHistory: 'None',
          consentGiven: true,
        });

      expect(regRes.status).toBe(201);
      const donorCode = regRes.body.donorId;
      expect(donorCode).toMatch(/^D-\d{6}$/);

      // Now donor logs in with their newly issued Donor ID and DOB default password (25081996)
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: donorCode,
          password: '25081996',
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.role).toBe('DONOR');
      expect(loginRes.body.user.fullName).toBe('Walkin Portal Tester');

      // Now donor accesses their portal
      const portalRes = await request(app)
        .get('/api/donors/portal/me')
        .set('Authorization', `Bearer ${loginRes.body.token}`);

      expect(portalRes.status).toBe(200);
      expect(portalRes.body.donor.donorCode).toBe(donorCode);
      expect(portalRes.body.stats.totalDonations).toBe(0);
      expect(portalRes.body.stats.isEligibleNow).toBe(true);
    });
  });
});
