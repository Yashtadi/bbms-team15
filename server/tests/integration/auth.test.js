const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { generateTotp } = require('../../src/modules/auth/mfa.totp');

const PASSWORD = 'Password@123'; // seed password, see server/db/seed.sql
const eligiblePayload = { age: 30, weight: 60, hemoglobin: 13.5, daysSinceLastDonation: 100 };

async function loginAs(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body.token;
}

describe('TC-Sec-02: login and role-based access (integration)', () => {
  afterAll(async () => {
    try {
      await db.query(
        `UPDATE users
         SET mfa_secret = NULL, mfa_enabled = FALSE, mfa_failed_attempts = 0, mfa_locked_until = NULL
         WHERE id IN (1, 2)`
      );
    } finally {
      await db.end();
    }
  });

  describe('POST /api/auth/login', () => {
    it('returns 200 with a token and the user for valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'labtech@bbms.test', password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.user).toEqual({ id: 3, email: 'labtech@bbms.test', fullName: 'Labtech 1', role: 'LAB_TECH' });
    });

    it('returns 401 for a wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'labtech@bbms.test', password: 'wrong-password' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
      expect(res.body).not.toHaveProperty('token');
    });

    it('returns 400 when the password is missing', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'labtech@bbms.test' });

      expect(res.status).toBe(400);
    });

    it('requires an authenticator code before Admin can receive an access token', async () => {
      await db.query(
        `UPDATE users
         SET mfa_secret = NULL, mfa_enabled = FALSE, mfa_failed_attempts = 0, mfa_locked_until = NULL
         WHERE id = 1`
      );
      const firstFactor = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@bbms.test', password: PASSWORD });

      expect(firstFactor.status).toBe(200);
      expect(firstFactor.body.mfaSetupRequired).toBe(true);
      expect(firstFactor.body).not.toHaveProperty('token');

      const setup = await request(app)
        .post('/api/auth/mfa/setup')
        .send({ setupToken: firstFactor.body.setupToken });
      expect(setup.status).toBe(200);

      const enrolled = await request(app)
        .post('/api/auth/mfa/setup/verify')
        .send({
          setupToken: firstFactor.body.setupToken,
          code: generateTotp(setup.body.secret),
        });
      expect(enrolled.status).toBe(200);
      expect(enrolled.body.token).toEqual(expect.any(String));

      const nextLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@bbms.test', password: PASSWORD });
      expect(nextLogin.body.mfaRequired).toBe(true);
      expect(nextLogin.body).not.toHaveProperty('token');

      const denied = await request(app)
        .post('/api/auth/mfa/verify')
        .send({ challengeToken: nextLogin.body.challengeToken, code: 'not-a-code' });
      expect(denied.status).toBe(401);
      expect(denied.body).not.toHaveProperty('token');

      const verified = await request(app)
        .post('/api/auth/mfa/verify')
        .send({
          challengeToken: nextLogin.body.challengeToken,
          code: generateTotp(setup.body.secret),
        });
      expect(verified.status).toBe(200);
      expect(verified.body.token).toEqual(expect.any(String));

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const invalid = await request(app)
          .post('/api/auth/mfa/verify')
          .send({ challengeToken: nextLogin.body.challengeToken, code: 'not-a-code' });
        expect(invalid.status).toBe(attempt === 4 ? 429 : 401);
      }

      const lockedOut = await request(app)
        .post('/api/auth/mfa/verify')
        .send({
          challengeToken: nextLogin.body.challengeToken,
          code: generateTotp(setup.body.secret),
        });
      expect(lockedOut.status).toBe(429);
      expect(lockedOut.body).not.toHaveProperty('token');
    });
  });

  describe('protected route POST /api/donors/eligibility (LAB_TECH, ADMIN only)', () => {
    it('returns 401 with no token', async () => {
      const res = await request(app).post('/api/donors/eligibility').send(eligiblePayload);

      expect(res.status).toBe(401);
    });

    it('returns 403 for a logged-in user with the wrong role (HOSPITAL)', async () => {
      const token = await loginAs('hospital@bbms.test');

      const res = await request(app)
        .post('/api/donors/eligibility')
        .set('Authorization', `Bearer ${token}`)
        .send(eligiblePayload);

      expect(res.status).toBe(403);
    });

    it('returns 200 for a logged-in user with the right role (LAB_TECH)', async () => {
      const token = await loginAs('labtech@bbms.test');

      const res = await request(app)
        .post('/api/donors/eligibility')
        .set('Authorization', `Bearer ${token}`)
        .send(eligiblePayload);

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(true);
    });
  });
});
