const request = require('supertest');
const express = require('express');

const router = require('../../src/modules/request/request.routes');
const requestService = require('../../src/modules/request/request.service');
const { authHeader } = require('../helpers/auth');

jest.mock('../../src/modules/request/request.service');

describe('TC-Req-01: request.routes access and error mapping (unit)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/blood-requests', router);
    jest.clearAllMocks();
  });

  describe('POST /api/blood-requests', () => {
    const validBody = {
      patientName: 'Kavita Joshi',
      patientBloodGroup: 'O+',
      component: 'PRBC',
      unitsRequested: 1,
      priority: 'ROUTINE',
    };

    it('returns 401 without a token', async () => {
      const res = await request(app).post('/api/blood-requests').send(validBody);
      expect(res.status).toBe(401);
      expect(requestService.submitBloodRequest).not.toHaveBeenCalled();
    });

    it.each(['DONOR', 'LAB_TECH', 'MANAGER'])(
      'returns 403 for unauthorized role %s',
      async (role) => {
        const res = await request(app)
          .post('/api/blood-requests')
          .set(authHeader(role))
          .send(validBody);
        expect(res.status).toBe(403);
        expect(requestService.submitBloodRequest).not.toHaveBeenCalled();
      }
    );

    it('lets HOSPITAL role submit a request, capturing user id from token (201)', async () => {
      requestService.submitBloodRequest.mockResolvedValue({
        id: 10,
        requestCode: 'R-000010',
        status: 'PENDING',
        ...validBody,
      });

      const res = await request(app)
        .post('/api/blood-requests')
        .set(authHeader('HOSPITAL'))
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.requestCode).toBe('R-000010');
      expect(res.body.status).toBe('PENDING');
      // Hospital user in seed is ID 5
      expect(requestService.submitBloodRequest).toHaveBeenCalledWith(validBody, 5);
    });

    it('lets ADMIN role submit a blood request (201)', async () => {
      requestService.submitBloodRequest.mockResolvedValue({
        id: 11,
        requestCode: 'R-000011',
        status: 'PENDING',
        ...validBody,
      });

      const res = await request(app)
        .post('/api/blood-requests')
        .set(authHeader('ADMIN'))
        .send(validBody);

      expect(res.status).toBe(201);
      expect(requestService.submitBloodRequest).toHaveBeenCalledWith(validBody, 1);
    });

    it('returns 400 when validation fails', async () => {
      const err = new Error('Validation failed');
      err.status = 400;
      err.errors = { patientName: 'Patient name is required' };
      requestService.submitBloodRequest.mockRejectedValue(err);

      const res = await request(app)
        .post('/api/blood-requests')
        .set(authHeader('HOSPITAL'))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.errors.patientName).toBe('Patient name is required');
    });

    it('returns 500 when an unexpected service error occurs', async () => {
      requestService.submitBloodRequest.mockRejectedValue(new Error('DB connection dead'));

      const res = await request(app)
        .post('/api/blood-requests')
        .set(authHeader('HOSPITAL'))
        .send(validBody);

      expect(res.status).toBe(500);
      expect(res.body.message).toMatch(/Failed to submit blood request/i);
    });
  });

  describe('GET /api/blood-requests', () => {
    it('returns 401 without token', async () => {
      const res = await request(app).get('/api/blood-requests');
      expect(res.status).toBe(401);
    });

    it('returns 403 for DONOR role', async () => {
      const res = await request(app).get('/api/blood-requests').set(authHeader('DONOR'));
      expect(res.status).toBe(403);
    });

    it.each(['HOSPITAL', 'MANAGER', 'ADMIN', 'LAB_TECH'])(
      'allows role %s to list requests (200)',
      async (role) => {
        requestService.getBloodRequests.mockResolvedValue([
          { id: 1, requestCode: 'R-000001', status: 'PENDING' },
        ]);

        const res = await request(app).get('/api/blood-requests').set(authHeader(role));
        expect(res.status).toBe(200);
        expect(res.body.requests).toHaveLength(1);
        expect(requestService.getBloodRequests).toHaveBeenCalled();
      }
    );
  });

  describe('GET /api/blood-requests/:idOrCode', () => {
    it('returns 200 when request is found', async () => {
      requestService.getBloodRequestById.mockResolvedValue({
        id: 1,
        requestCode: 'R-000001',
        patientName: 'Test Patient',
      });

      const res = await request(app).get('/api/blood-requests/R-000001').set(authHeader('HOSPITAL'));
      expect(res.status).toBe(200);
      expect(res.body.request.requestCode).toBe('R-000001');
    });

    it('returns 404 when request is not found', async () => {
      const err = new Error('Not found');
      err.status = 404;
      requestService.getBloodRequestById.mockRejectedValue(err);

      const res = await request(app).get('/api/blood-requests/R-999999').set(authHeader('HOSPITAL'));
      expect(res.status).toBe(404);
    });

    it('returns 403 when hospital user attempts to view cross-hospital request', async () => {
      const err = new Error('Forbidden');
      err.status = 403;
      requestService.getBloodRequestById.mockRejectedValue(err);

      const res = await request(app).get('/api/blood-requests/R-000002').set(authHeader('HOSPITAL'));
      expect(res.status).toBe(403);
    });
  });
});
