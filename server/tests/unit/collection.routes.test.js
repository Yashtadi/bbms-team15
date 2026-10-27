const request = require('supertest');
const express = require('express');

const router = require('../../src/modules/collection/collection.routes');
const collectionService = require('../../src/modules/collection/collection.service');
const { authHeader } = require('../helpers/auth');

jest.mock('../../src/modules/collection/collection.service');

describe('TC-Don-01: collection.routes access and error mapping (unit)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/donations', router);
    jest.clearAllMocks();
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/donations').send({ donorId: 'D-000001' });

    expect(res.status).toBe(401);
    expect(collectionService.startDonation).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'MANAGER', 'HOSPITAL', 'DONOR'])(
    'returns 403 for the %s role (only LAB_TECH may record sessions, AC 4)',
    async (role) => {
      const res = await request(app)
        .post('/api/donations').set(authHeader(role))
        .send({ donorId: 'D-000001', volumeMl: 450 });

      expect(res.status).toBe(403);
      expect(collectionService.startDonation).not.toHaveBeenCalled();
    }
  );

  it('lets LAB_TECH record a session, taking the staff ID from the token (AC 1 & AC 4)', async () => {
    collectionService.startDonation.mockResolvedValue({ donationId: 1, status: 'IN_PROGRESS' });

    const res = await request(app)
      .post('/api/donations').set(authHeader('LAB_TECH'))
      .send({ donorId: 'D-000001', volumeMl: 450, staffId: 1, collectedBy: 1 });

    expect(res.status).toBe(201);
    // Seed LAB_TECH user is id 3; a staffId sent in the body must not override it
    expect(collectionService.startDonation).toHaveBeenCalledWith(
      expect.objectContaining({ donorId: 'D-000001', staffId: 3 })
    );
  });

  it('returns 422 with the DONOR_NOT_ELIGIBLE code', async () => {
    const error = new Error('Donor is not eligible to donate (status DEFERRED)');
    error.status = 422;
    error.code = 'DONOR_NOT_ELIGIBLE';
    collectionService.startDonation.mockRejectedValue(error);

    const res = await request(app)
      .post('/api/donations').set(authHeader('LAB_TECH'))
      .send({ donorId: 'D-000003', volumeMl: 450 });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ message: error.message, code: 'DONOR_NOT_ELIGIBLE' });
  });

  it('returns 400 with field errors', async () => {
    const error = new Error('Validation failed');
    error.status = 400;
    error.errors = { volumeMl: 'Volume (mL) is required' };
    collectionService.startDonation.mockRejectedValue(error);

    const res = await request(app)
      .post('/api/donations').set(authHeader('LAB_TECH'))
      .send({ donorId: 'D-000001' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Validation failed', errors: error.errors });
  });
});

describe('TC-Don-02: vitals routes access and error mapping (unit)', () => {
  let app;
  const vitals = { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, hemoglobinGDl: 13.5 };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/donations', router);
    jest.clearAllMocks();
  });

  it.each(['pre', 'post'])('returns 401 without a token (%s)', async (phase) => {
    const res = await request(app).put(`/api/donations/21/vitals/${phase}`).send(vitals);

    expect(res.status).toBe(401);
    expect(collectionService.recordVitals).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'MANAGER', 'HOSPITAL', 'DONOR'])('returns 403 for the %s role', async (role) => {
    const res = await request(app).put('/api/donations/21/vitals/pre').set(authHeader(role)).send(vitals);

    expect(res.status).toBe(403);
    expect(collectionService.recordVitals).not.toHaveBeenCalled();
  });

  it.each([
    ['pre', 'PRE'],
    ['post', 'POST'],
  ])('lets LAB_TECH record %s-donation vitals (AC 1)', async (path, phase) => {
    const result = { donationId: 21, phase, vitals, warnings: [] };
    collectionService.recordVitals.mockResolvedValue(result);

    const res = await request(app).put(`/api/donations/21/vitals/${path}`).set(authHeader('LAB_TECH')).send(vitals);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(result);
    expect(collectionService.recordVitals).toHaveBeenCalledWith('21', phase, vitals);
  });

  it('passes warnings through with 200 (AC 3)', async () => {
    const warnings = [{ field: 'pulseBpm', value: 101, min: 60, max: 100, message: 'Pulse 101 bpm is above ...' }];
    collectionService.recordVitals.mockResolvedValue({ donationId: 21, phase: 'PRE', vitals, warnings });

    const res = await request(app).put('/api/donations/21/vitals/pre').set(authHeader('LAB_TECH')).send(vitals);

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual(warnings);
  });

  it('returns 400 with field errors (AC 4)', async () => {
    const error = new Error('Validation failed');
    error.status = 400;
    error.errors = { pulseBpm: 'Pulse must be a number' };
    collectionService.recordVitals.mockRejectedValue(error);

    const res = await request(app)
      .put('/api/donations/21/vitals/pre').set(authHeader('LAB_TECH'))
      .send({ ...vitals, pulseBpm: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Validation failed', errors: error.errors });
  });

  it('returns 404 for an unknown donation', async () => {
    const error = new Error('Donation not found');
    error.status = 404;
    collectionService.recordVitals.mockRejectedValue(error);

    const res = await request(app).put('/api/donations/999999/vitals/post').set(authHeader('LAB_TECH')).send(vitals);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Donation not found' });
  });

  it('returns 500 on an unexpected error', async () => {
    collectionService.recordVitals.mockRejectedValue(new Error('DB down'));

    const res = await request(app).put('/api/donations/21/vitals/pre').set(authHeader('LAB_TECH')).send(vitals);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to record vitals');
  });

  it('has no route for other phases', async () => {
    const res = await request(app).put('/api/donations/21/vitals/during').set(authHeader('LAB_TECH')).send(vitals);

    expect(res.status).toBe(404);
    expect(collectionService.recordVitals).not.toHaveBeenCalled();
  });
});

describe('TC-Don-03: unit barcode lookup route access and error mapping (unit)', () => {
  let app;
  const record = {
    unitId: 'U-2026-000007',
    barcode: { format: 'CODE128', value: 'U-2026-000007' },
    bloodGroup: 'PENDING',
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/donations', router);
    jest.clearAllMocks();
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/donations/units/U-2026-000007');

    expect(res.status).toBe(401);
    expect(collectionService.getUnitByBarcode).not.toHaveBeenCalled();
  });

  it.each(['HOSPITAL', 'DONOR'])('returns 403 for the %s role', async (role) => {
    const res = await request(app).get('/api/donations/units/U-2026-000007').set(authHeader(role));

    expect(res.status).toBe(403);
    expect(collectionService.getUnitByBarcode).not.toHaveBeenCalled();
  });

  it.each(['LAB_TECH', 'MANAGER', 'ADMIN'])('lets %s look a unit up by its barcode (AC 4)', async (role) => {
    collectionService.getUnitByBarcode.mockResolvedValue(record);

    const res = await request(app).get('/api/donations/units/U-2026-000007').set(authHeader(role));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(record);
    expect(collectionService.getUnitByBarcode).toHaveBeenCalledWith('U-2026-000007');
  });

  it('returns 400 with field errors for a malformed code', async () => {
    const error = new Error('Validation failed');
    error.status = 400;
    error.errors = { unitId: 'Unit ID must look like U-2026-000123' };
    collectionService.getUnitByBarcode.mockRejectedValue(error);

    const res = await request(app).get('/api/donations/units/hello').set(authHeader('LAB_TECH'));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Validation failed', errors: error.errors });
  });

  it('returns 404 for an unknown unit', async () => {
    const error = new Error('Blood unit not found');
    error.status = 404;
    collectionService.getUnitByBarcode.mockRejectedValue(error);

    const res = await request(app).get('/api/donations/units/U-2026-999999').set(authHeader('LAB_TECH'));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Blood unit not found' });
  });

  it('returns 500 on an unexpected error', async () => {
    collectionService.getUnitByBarcode.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/api/donations/units/U-2026-000007').set(authHeader('LAB_TECH'));

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to look up blood unit');
  });
});
