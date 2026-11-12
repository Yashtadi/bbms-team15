const request = require('supertest');
const express = require('express');

const router = require('../../src/modules/health/health.routes');
const healthService = require('../../src/modules/health/health.service');

jest.mock('../../src/modules/health/health.service');

describe('TC-Ops-01: BBMS-NF-002 health routes (unit)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use('/api/health', router);
    jest.clearAllMocks();
  });

  it('keeps GET /api/health exactly { status: "ok" } and public (no token needed)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/health/live returns the liveness body', async () => {
    healthService.getLiveness.mockReturnValue({ status: 'ok', uptimeSeconds: 42, timestamp: 't' });
    const res = await request(app).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', uptimeSeconds: 42, timestamp: 't' });
  });

  it('GET /api/health/ready returns 200 when ready', async () => {
    healthService.getReadiness.mockResolvedValue({
      httpStatus: 200,
      body: { status: 'ok', checks: { server: 'up', database: 'up' } },
    });
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe('up');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/health/ready returns 503 when the database is down', async () => {
    healthService.getReadiness.mockResolvedValue({
      httpStatus: 503,
      body: { status: 'unavailable', checks: { server: 'up', database: 'down' } },
    });
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
  });

  it('GET /api/health/ready returns a bare 503 if the check itself throws', async () => {
    healthService.getReadiness.mockRejectedValue(new Error('secret detail'));
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});
