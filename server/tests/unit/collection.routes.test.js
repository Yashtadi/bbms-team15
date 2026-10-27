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
