const request = require('supertest');
const express = require('express');

const inventoryRouter = require('../../src/modules/inventory/inventory.routes');
const inventoryRepository = require('../../src/modules/inventory/inventory.repository');
const inventoryService = require('../../src/modules/inventory/inventory.service');
const { authHeader } = require('../helpers/auth');

jest.mock('../../src/modules/inventory/inventory.repository');
jest.mock('../../src/modules/inventory/inventory.service');

describe('BBMS-F-022 available inventory route', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use('/api/inventory', inventoryRouter);
    jest.clearAllMocks();
  });

  it('requires an authorized inventory role', async () => {
    const response = await request(app).get('/api/inventory').set(authHeader('DONOR'));

    expect(response.status).toBe(403);
    expect(inventoryRepository.listAvailable).not.toHaveBeenCalled();
  });

  it('returns only the repository-approved available units', async () => {
    const units = [{ unit_code: 'U-2026-000123', status: 'AVAILABLE' }];
    inventoryRepository.listAvailable.mockResolvedValue(units);

    const response = await request(app).get('/api/inventory').set(authHeader('HOSPITAL'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ units });
    expect(inventoryRepository.listAvailable).toHaveBeenCalledWith({ bloodGroup: null, component: null });
  });

  it('rejects invalid filters before querying inventory', async () => {
    const response = await request(app)
      .get('/api/inventory?bloodGroup=ABO&component=PLASMA')
      .set(authHeader('MANAGER'));

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveProperty('bloodGroup');
    expect(response.body.errors).toHaveProperty('component');
    expect(inventoryRepository.listAvailable).not.toHaveBeenCalled();
  });
});

describe('TC-Inv-01 (BBMS-F-030) inventory summary route', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use('/api/inventory', inventoryRouter);
    jest.clearAllMocks();
  });

  it('requires a login token (401)', async () => {
    const response = await request(app).get('/api/inventory/summary');

    expect(response.status).toBe(401);
    expect(inventoryService.getStockSummary).not.toHaveBeenCalled();
  });

  it.each(['HOSPITAL', 'DONOR'])('blocks %s from the dashboard summary (403)', async (role) => {
    const response = await request(app).get('/api/inventory/summary').set(authHeader(role));

    expect(response.status).toBe(403);
    expect(inventoryService.getStockSummary).not.toHaveBeenCalled();
  });

  it.each(['LAB_TECH', 'MANAGER', 'ADMIN'])('returns the stock summary to %s', async (role) => {
    const summary = {
      generatedAt: '2026-11-03T10:00:00.000Z',
      totals: { units: 1, volumeMl: 280, nextExpiry: '2026-12-05T10:00:00.000Z' },
      stock: [{ bloodGroup: 'O-', component: 'PRBC', units: 1, volumeMl: 280, nextExpiry: '2026-12-05T10:00:00.000Z' }],
    };
    inventoryService.getStockSummary.mockResolvedValue(summary);

    const response = await request(app).get('/api/inventory/summary').set(authHeader(role));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(summary);
  });

  it('returns 500 with a safe message when the summary cannot be loaded', async () => {
    inventoryService.getStockSummary.mockRejectedValue(new Error('ER_ACCESS_DENIED secret detail'));

    const response = await request(app).get('/api/inventory/summary').set(authHeader('MANAGER'));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to load inventory summary' });
  });
});
