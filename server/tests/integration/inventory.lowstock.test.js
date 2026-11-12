const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');
const notificationGateway = require('../../src/modules/inventory/notification.gateway');

// TC-Inv-05 / BBMS-F-034 (SRS §4.4): Low-stock alerts
describe('TC-Inv-05: Low-Stock Alerts (Integration)', () => {
  beforeEach(() => {
    notificationGateway.clearDispatchedAlerts();
  });

  afterAll(async () => {
    await db.end();
  });

  it('rejects unauthenticated requests (401)', async () => {
    const res = await request(app).get('/api/inventory/alerts/low-stock');
    expect(res.status).toBe(401);
  });

  it('restricts hospital and donor roles from viewing manager low-stock alerts (403)', async () => {
    const hospitalRes = await request(app).get('/api/inventory/alerts/low-stock').set(authHeader('HOSPITAL'));
    expect(hospitalRes.status).toBe(403);

    const donorRes = await request(app).get('/api/inventory/alerts/low-stock').set(authHeader('DONOR'));
    expect(donorRes.status).toBe(403);
  });

  it('alerts the blood bank manager when available units fall below safety threshold (default 3 units)', async () => {
    const res = await request(app)
      .get('/api/inventory/alerts/low-stock')
      .set(authHeader('MANAGER'));

    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(3);
    expect(res.body.totalGroupsMonitored).toBe(8);
    expect(Array.isArray(res.body.alerts)).toBe(true);
    expect(Array.isArray(res.body.stockByGroup)).toBe(true);
    expect(res.body.stockByGroup.length).toBe(8);

    // O- has 2 units (< 3) -> LOW_STOCK
    const oMinusAlert = res.body.alerts.find((a) => a.bloodGroup === 'O-');
    expect(oMinusAlert).toBeDefined();
    expect(oMinusAlert.availableUnits).toBe(2);
    expect(oMinusAlert.deficit).toBe(1);
    expect(oMinusAlert.urgency).toBe('LOW_STOCK');

    // Groups with 0 units are flagged as OUT_OF_STOCK (e.g. B+)
    const bPlusAlert = res.body.alerts.find((a) => a.bloodGroup === 'B+');
    expect(bPlusAlert).toBeDefined();
    expect(bPlusAlert.availableUnits).toBe(0);
    expect(bPlusAlert.deficit).toBe(3);
    expect(bPlusAlert.urgency).toBe('OUT_OF_STOCK');

    // Notification gateway dispatch recorded (SRS note: notification gateway mocked)
    const dispatched = notificationGateway.getDispatchedAlerts();
    expect(dispatched.length).toBe(res.body.alertCount);
    expect(dispatched.some((d) => d.bloodGroup === 'O-')).toBe(true);
    expect(dispatched.some((d) => d.bloodGroup === 'B+')).toBe(true);
  });

  it('supports configurable safety threshold: threshold=2 excludes blood groups with 2 units', async () => {
    const res = await request(app)
      .get('/api/inventory/alerts/low-stock?threshold=2')
      .set(authHeader('MANAGER'));

    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(2);

    // O- has exactly 2 available units, so it is NOT below threshold of 2
    const oMinusAlert = res.body.alerts.find((a) => a.bloodGroup === 'O-');
    expect(oMinusAlert).toBeUndefined();

    // Groups with 0 units remain in alert (deficit of 2)
    const zeroGroups = res.body.alerts.filter((a) => a.availableUnits === 0);
    expect(zeroGroups.length).toBeGreaterThanOrEqual(1);
    expect(zeroGroups.every((g) => g.urgency === 'OUT_OF_STOCK')).toBe(true);
    expect(zeroGroups.every((g) => g.deficit === 2)).toBe(true);
  });

  it('supports alias /api/inventory/low-stock-alerts and query by single blood group', async () => {
    const res = await request(app)
      .get('/api/inventory/low-stock-alerts?threshold=5&bloodGroup=O-')
      .set(authHeader('LAB_TECH'));

    expect(res.status).toBe(200);
    expect(res.body.totalGroupsMonitored).toBe(1);
    expect(res.body.alertCount).toBe(1);
    expect(res.body.alerts[0].bloodGroup).toBe('O-');
    expect(res.body.alerts[0].deficit).toBe(3); // 5 - 2 = 3
  });

  it('rejects invalid threshold values with 400', async () => {
    const res = await request(app)
      .get('/api/inventory/alerts/low-stock?threshold=-5')
      .set(authHeader('MANAGER'));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_THRESHOLD');
  });
});
