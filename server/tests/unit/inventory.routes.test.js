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

describe('TC-Inv-02: component separation and lineage routes (unit)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/inventory', inventoryRouter);
    jest.clearAllMocks();
  });

  const separate = (role) => {
    const req = request(app).post('/api/inventory/units/U-2026-000007/separate');
    return (role ? req.set(authHeader(role)) : req).send({ components: ['PRBC'] });
  };

  it('returns 401 without a token', async () => {
    expect((await separate()).status).toBe(401);
    expect((await request(app).get('/api/inventory/units/U-2026-000007/lineage')).status).toBe(401);
    expect(inventoryService.separateUnit).not.toHaveBeenCalled();
  });

  it.each(['HOSPITAL', 'DONOR'])('returns 403 for %s on both routes', async (role) => {
    expect((await separate(role)).status).toBe(403);
    const lineage = await request(app).get('/api/inventory/units/U-2026-000007/lineage').set(authHeader(role));
    expect(lineage.status).toBe(403);
    expect(inventoryService.separateUnit).not.toHaveBeenCalled();
    expect(inventoryService.getLineage).not.toHaveBeenCalled();
  });

  it.each(['LAB_TECH', 'MANAGER', 'ADMIN'])('lets %s separate (201), recording who did it', async (role) => {
    inventoryService.separateUnit.mockResolvedValue({ parent: {}, children: [] });

    const res = await separate(role);

    expect(res.status).toBe(201);
    expect(inventoryService.separateUnit).toHaveBeenCalledWith('U-2026-000007', { components: ['PRBC'] }, expect.any(Number));
  });

  it.each([
    [400, { errors: { components: 'Choose at least one component' } }],
    [404, {}],
    [409, { code: 'ALREADY_SEPARATED' }],
    [422, { code: 'NOT_WHOLE_BLOOD' }],
  ])('passes a %i from the service through with its details', async (status, extra) => {
    inventoryService.separateUnit.mockRejectedValue(Object.assign(new Error('nope'), { status }, extra));

    const res = await separate('LAB_TECH');

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ message: 'nope', ...extra });
  });

  it('hides unexpected errors behind a safe 500 message', async () => {
    inventoryService.separateUnit.mockRejectedValue(new Error('ER_LOCK_DEADLOCK detail'));
    const res = await separate('LAB_TECH');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Failed to separate blood unit' });
  });

  it('returns the lineage (200)', async () => {
    inventoryService.getLineage.mockResolvedValue({ unit: { unitId: 'U-2026-000007' } });
    const res = await request(app).get('/api/inventory/units/U-2026-000007/lineage').set(authHeader('MANAGER'));
    expect(res.status).toBe(200);
    expect(res.body.unit.unitId).toBe('U-2026-000007');
  });
});
