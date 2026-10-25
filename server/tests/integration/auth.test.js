const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');

const PASSWORD = 'Password@123'; // seed password, see server/db/seed.sql
const eligiblePayload = { age: 30, weight: 60, hemoglobin: 13.5, daysSinceLastDonation: 100 };

async function loginAs(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body.token;
}

describe('TC-Sec-02: login and role-based access (integration)', () => {
  afterAll(async () => {
    await db.end();
  });

  describe('POST /api/auth/login', () => {
    it('returns 200 with a token and the user for valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'labtech@bbms.test', password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.user).toEqual({ id: 3, email: 'labtech@bbms.test', fullName: 'Lata LabTech', role: 'LAB_TECH' });
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
