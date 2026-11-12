const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');

describe('GET /api/health', () => {
  afterAll(() => db.end());

  it('returns 200 and status ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  describe('TC-Ops-01: BBMS-NF-002 liveness and readiness', () => {
    it('GET /api/health/live reports the process is up', async () => {
      const res = await request(app).get('/api/health/live');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Number.isInteger(res.body.uptimeSeconds)).toBe(true);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('GET /api/health/ready reports ready against the real database, without a token', async () => {
      const res = await request(app).get('/api/health/ready');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.checks).toMatchObject({ server: 'up', database: 'up' });
      expect(res.body.checks.databaseLatencyMs).toBeLessThan(2000);
    });

    it('still serves the SR-001 TLS policy at /api/health/tls', async () => {
      const res = await request(app).get('/api/health/tls');
      expect(res.status).toBe(200);
      expect(res.body.requirement).toBe('BBMS-SR-001');
    });
  });
});
