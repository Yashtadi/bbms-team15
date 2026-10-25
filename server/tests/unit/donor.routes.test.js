const request = require('supertest');
const express = require('express');

const router = require('../../src/modules/donor/donor.routes');
const donorService = require('../../src/modules/donor/donor.service');
const { authHeader } = require('../helpers/auth');

jest.mock('../../src/modules/donor/donor.service');

describe('donor.routes: duplicate entry error handling (#46)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/donors', router);
    jest.clearAllMocks();
  });

  it('returns 409 when ER_DUP_ENTRY is on id_proof', async () => {
    const error = new Error("Duplicate entry 'AADHAAR-123' for key 'donors.id_proof'");
    error.code = 'ER_DUP_ENTRY';
    error.sqlMessage = "Duplicate entry 'AADHAAR-123' for key 'donors.id_proof'";
    donorService.registerDonor.mockRejectedValue(error);

    const res = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({ name: 'Test' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('A donor with this ID proof is already registered');
  });

  it('returns 500 (not 409) when ER_DUP_ENTRY is on any other field (e.g. donor_code)', async () => {
    const error = new Error("Duplicate entry 'D-000012' for key 'donors.donor_code'");
    error.code = 'ER_DUP_ENTRY';
    error.sqlMessage = "Duplicate entry 'D-000012' for key 'donors.donor_code'";
    donorService.registerDonor.mockRejectedValue(error);

    const res = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({ name: 'Test' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to register donor');
    expect(res.body.error).toContain('donors.donor_code');
  });

  it('returns 409 when status is 409 from application check', async () => {
    const error = new Error('A donor with this ID proof is already registered');
    error.status = 409;
    donorService.registerDonor.mockRejectedValue(error);

    const res = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({ name: 'Test' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('A donor with this ID proof is already registered');
  });
});
