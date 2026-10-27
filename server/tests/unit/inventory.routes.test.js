const request = require('supertest');
const express = require('express');

const inventoryRouter = require('../../src/modules/inventory/inventory.routes');
const inventoryRepository = require('../../src/modules/inventory/inventory.repository');
const { authHeader } = require('../helpers/auth');

jest.mock('../../src/modules/inventory/inventory.repository');

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
