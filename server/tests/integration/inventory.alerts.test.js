const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

// TC-Inv-03 / BBMS-F-032 (SRS §4.4): Expiry alerts for units nearing expiry
describe('TC-Inv-03: Expiry Alerts for Units Nearing Expiry (Integration)', () => {
  afterAll(async () => {
    await db.end();
  });

  it('rejects unauthenticated requests (401)', async () => {
    const res = await request(app).get('/api/inventory/alerts/expiry');
    expect(res.status).toBe(401);
  });

  it('restricts hospital and donor roles from viewing manager expiry alerts (403)', async () => {
    const hospitalRes = await request(app).get('/api/inventory/alerts/expiry').set(authHeader('HOSPITAL'));
    expect(hospitalRes.status).toBe(403);

    const donorRes = await request(app).get('/api/inventory/alerts/expiry').set(authHeader('DONOR'));
    expect(donorRes.status).toBe(403);
  });

  it('returns units nearing expiry with default threshold of 3 days to manager', async () => {
    const res = await request(app).get('/api/inventory/alerts/expiry').set(authHeader('MANAGER'));

    expect(res.status).toBe(200);
    expect(res.body.thresholdDays).toBe(3);
    expect(res.body.alertCount).toBeGreaterThanOrEqual(1);

    // Seed unit U-2026-000004 expires in 2 days
    const nearExpiryUnit = res.body.alerts.find((u) => u.unitCode === 'U-2026-000004');
    expect(nearExpiryUnit).toBeDefined();
    expect(nearExpiryUnit.bloodGroup).toBe('A+');
    expect(nearExpiryUnit.component).toBe('PRBC');
    expect(nearExpiryUnit.status).toBe('AVAILABLE');
    expect(nearExpiryUnit.daysRemaining).toBeLessThanOrEqual(3);
    expect(nearExpiryUnit.daysRemaining).toBeGreaterThanOrEqual(1);
    expect(nearExpiryUnit.urgency).toMatch(/^(CRITICAL|WARNING)$/);

    // Seed unit U-2026-000003 is already EXPIRED: must not appear in alerts
    const expiredUnit = res.body.alerts.find((u) => u.unitCode === 'U-2026-000003');
    expect(expiredUnit).toBeUndefined();

    // Seed unit U-2026-000006 is DISCARDED: must not appear in alerts
    const discardedUnit = res.body.alerts.find((u) => u.unitCode === 'U-2026-000006');
    expect(discardedUnit).toBeUndefined();
  });

  it('supports configurable threshold parameter: thresholdDays=1 excludes units expiring in 2 days', async () => {
    const res = await request(app)
      .get('/api/inventory/alerts/expiry?thresholdDays=1')
      .set(authHeader('MANAGER'));

    expect(res.status).toBe(200);
    expect(res.body.thresholdDays).toBe(1);

    // Seed unit U-2026-000004 expires in 2 days, so it is outside a 1-day threshold
    const unit4 = res.body.alerts.find((u) => u.unitCode === 'U-2026-000004');
    expect(unit4).toBeUndefined();
  });

  it('supports configurable threshold parameter: thresholdDays=7 includes units expiring in 2 days', async () => {
    const res = await request(app)
      .get('/api/inventory/expiry-alerts?thresholdDays=7')
      .set(authHeader('MANAGER'));

    expect(res.status).toBe(200);
    expect(res.body.thresholdDays).toBe(7);

    const unit4 = res.body.alerts.find((u) => u.unitCode === 'U-2026-000004');
    expect(unit4).toBeDefined();
  });

  it('rejects invalid threshold values with 400', async () => {
    const res = await request(app)
      .get('/api/inventory/alerts/expiry?thresholdDays=invalid')
      .set(authHeader('MANAGER'));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_THRESHOLD');
  });
});
