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

  describe('TC-Req-02: Cross-match & Issuance Endpoints (Unit)', () => {
    describe('POST /api/blood-requests/:idOrCode/crossmatch', () => {
      const validCrossmatchBody = {
        unitCode: 'U-000001',
        result: 'COMPATIBLE',
      };

      it('returns 401 without token', async () => {
        const res = await request(app)
          .post('/api/blood-requests/R-000001/crossmatch')
          .send(validCrossmatchBody);
        expect(res.status).toBe(401);
      });

      it.each(['HOSPITAL', 'DONOR'])(
        'returns 403 for unauthorized role %s',
        async (role) => {
          const res = await request(app)
            .post('/api/blood-requests/R-000001/crossmatch')
            .set(authHeader(role))
            .send(validCrossmatchBody);
          expect(res.status).toBe(403);
          expect(requestService.recordCrossmatch).not.toHaveBeenCalled();
        }
      );

      it.each(['LAB_TECH', 'MANAGER', 'ADMIN'])(
        'allows authorized role %s to record crossmatch (201)',
        async (role) => {
          requestService.recordCrossmatch.mockResolvedValue({
            id: 1,
            requestId: 1,
            requestCode: 'R-000001',
            unitCode: 'U-000001',
            result: 'COMPATIBLE',
            readyForIssuance: true,
          });

          const res = await request(app)
            .post('/api/blood-requests/R-000001/crossmatch')
            .set(authHeader(role))
            .send(validCrossmatchBody);

          expect(res.status).toBe(201);
          expect(res.body.crossmatch.result).toBe('COMPATIBLE');
          expect(res.body.crossmatch.readyForIssuance).toBe(true);
        }
      );

      it('returns 400 when validation fails', async () => {
        const err = new Error('Result must be COMPATIBLE or INCOMPATIBLE');
        err.status = 400;
        requestService.recordCrossmatch.mockRejectedValue(err);

        const res = await request(app)
          .post('/api/blood-requests/R-000001/crossmatch')
          .set(authHeader('LAB_TECH'))
          .send({ unitCode: 'U-000001', result: 'INVALID' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/result must be compatible or incompatible/i);
      });

      it('returns 404 when request or unit is not found', async () => {
        const err = new Error("Blood unit 'U-999999' not found");
        err.status = 404;
        requestService.recordCrossmatch.mockRejectedValue(err);

        const res = await request(app)
          .post('/api/blood-requests/R-000001/crossmatch')
          .set(authHeader('LAB_TECH'))
          .send({ unitCode: 'U-999999', result: 'COMPATIBLE' });

        expect(res.status).toBe(404);
        expect(res.body.message).toMatch(/not found/i);
      });

      it('returns 422 when unit is clinically incompatible or ineligible', async () => {
        const err = new Error('Unit blood group (B+) is clinically incompatible with patient blood group (A+)');
        err.status = 422;
        requestService.recordCrossmatch.mockRejectedValue(err);

        const res = await request(app)
          .post('/api/blood-requests/R-000001/crossmatch')
          .set(authHeader('LAB_TECH'))
          .send(validCrossmatchBody);

        expect(res.status).toBe(422);
        expect(res.body.message).toMatch(/clinically incompatible/i);
      });
    });

    describe('GET /api/blood-requests/:idOrCode/crossmatches', () => {
      it('returns 401 without token', async () => {
        const res = await request(app).get('/api/blood-requests/R-000001/crossmatches');
        expect(res.status).toBe(401);
      });

      it('returns 403 for DONOR', async () => {
        const res = await request(app)
          .get('/api/blood-requests/R-000001/crossmatches')
          .set(authHeader('DONOR'));
        expect(res.status).toBe(403);
      });

      it.each(['HOSPITAL', 'LAB_TECH', 'MANAGER', 'ADMIN'])(
        'allows %s to list crossmatches (200)',
        async (role) => {
          requestService.getCrossmatchesForRequest.mockResolvedValue({
            request: { id: 1, requestCode: 'R-000001' },
            crossmatches: [{ id: 1, unitCode: 'U-000001', result: 'COMPATIBLE', readyForIssuance: true }],
          });

          const res = await request(app)
            .get('/api/blood-requests/R-000001/crossmatches')
            .set(authHeader(role));

          expect(res.status).toBe(200);
          expect(res.body.crossmatches).toHaveLength(1);
        }
      );
    });

    describe('GET /api/blood-requests/:idOrCode/crossmatch/:unitCode/check', () => {
      it('returns issuance readiness status (200)', async () => {
        requestService.getBloodRequestById.mockResolvedValue({ id: 1, requestCode: 'R-000001' });
        requestService.checkIssuanceReadiness.mockResolvedValue({
          readyForIssuance: true,
          unitCode: 'U-000001',
          crossmatchId: 10,
          result: 'COMPATIBLE',
        });

        const res = await request(app)
          .get('/api/blood-requests/R-000001/crossmatch/U-000001/check')
          .set(authHeader('LAB_TECH'));

        expect(res.status).toBe(200);
        expect(res.body.readyForIssuance).toBe(true);
      });
    });
  });
});

describe('TC-Req-03: BBMS-F-042 reservation routes access and error mapping (unit)', () => {
  let app;
  const base = '/api/blood-requests/R-000001/reservations';

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/blood-requests', router);
    jest.clearAllMocks();
  });

  const serviceError = (status, message, extra = {}) => Object.assign(new Error(message), { status }, extra);

  describe('POST /:idOrCode/reservations', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).post(base).send({ unitCode: 'U-2026-000001' });
      expect(res.status).toBe(401);
    });

    it.each(['HOSPITAL', 'DONOR'])('returns 403 for %s', async (role) => {
      const res = await request(app).post(base).set(authHeader(role)).send({ unitCode: 'U-2026-000001' });
      expect(res.status).toBe(403);
      expect(requestService.reserveUnitForRequest).not.toHaveBeenCalled();
    });

    it.each(['LAB_TECH', 'MANAGER', 'ADMIN'])('lets %s reserve a unit (201)', async (role) => {
      requestService.reserveUnitForRequest.mockResolvedValue({ unitCode: 'U-2026-000001', requestStatus: 'RESERVED' });

      const res = await request(app).post(base).set(authHeader(role)).send({ unitCode: 'U-2026-000001', holdMinutes: 30 });

      expect(res.status).toBe(201);
      expect(res.body.reservation.requestStatus).toBe('RESERVED');
      expect(requestService.reserveUnitForRequest).toHaveBeenCalledWith({
        idOrCode: 'R-000001',
        body: { unitCode: 'U-2026-000001', holdMinutes: 30 },
        user: expect.objectContaining({ role }),
      });
    });

    it.each([
      [400, undefined, { holdMinutes: 'bad' }],
      [404, undefined, undefined],
      [409, 'RESERVED_FOR_OTHER_REQUEST', undefined],
      [422, 'NO_CROSSMATCH', undefined],
    ])('maps a service %i error with its code and field errors', async (status, code, errors) => {
      requestService.reserveUnitForRequest.mockRejectedValue(serviceError(status, 'refused', { code, errors }));

      const res = await request(app).post(base).set(authHeader('LAB_TECH')).send({ unitCode: 'U-2026-000001' });

      expect(res.status).toBe(status);
      expect(res.body.message).toBe('refused');
      if (code) expect(res.body.code).toBe(code);
      if (errors) expect(res.body.errors).toEqual(errors);
    });

    it('returns 500 for an unexpected failure', async () => {
      requestService.reserveUnitForRequest.mockRejectedValue(new Error('boom'));
      const res = await request(app).post(base).set(authHeader('LAB_TECH')).send({ unitCode: 'U-2026-000001' });
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Failed to reserve blood unit');
    });
  });

  describe('GET /:idOrCode/reservations', () => {
    it.each(['HOSPITAL', 'LAB_TECH', 'MANAGER', 'ADMIN'])('lets %s view reservations (200)', async (role) => {
      requestService.getReservationsForRequest.mockResolvedValue({ request: { requestCode: 'R-000001' }, reservations: [] });
      const res = await request(app).get(base).set(authHeader(role));
      expect(res.status).toBe(200);
      expect(res.body.reservations).toEqual([]);
    });

    it('returns 403 for DONOR', async () => {
      const res = await request(app).get(base).set(authHeader('DONOR'));
      expect(res.status).toBe(403);
    });

    it("passes on the service's 403 for another hospital's request", async () => {
      requestService.getReservationsForRequest.mockRejectedValue(serviceError(403, 'Access forbidden'));
      const res = await request(app).get(base).set(authHeader('HOSPITAL'));
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /:idOrCode/reservations/:unitCode', () => {
    it.each(['HOSPITAL', 'DONOR'])('returns 403 for %s', async (role) => {
      const res = await request(app).delete(`${base}/U-2026-000001`).set(authHeader(role));
      expect(res.status).toBe(403);
      expect(requestService.releaseUnitReservation).not.toHaveBeenCalled();
    });

    it('releases a hold (200)', async () => {
      requestService.releaseUnitReservation.mockResolvedValue({ unitCode: 'U-2026-000001', unitStatus: 'AVAILABLE' });
      const res = await request(app).delete(`${base}/U-2026-000001`).set(authHeader('MANAGER'));
      expect(res.status).toBe(200);
      expect(res.body.released.unitStatus).toBe('AVAILABLE');
      expect(requestService.releaseUnitReservation).toHaveBeenCalledWith({
        idOrCode: 'R-000001',
        unitCode: 'U-2026-000001',
        user: expect.objectContaining({ role: 'MANAGER' }),
      });
    });

    it('returns 409 when the unit is not held for the request', async () => {
      requestService.releaseUnitReservation.mockRejectedValue(serviceError(409, 'not reserved', { code: 'NOT_RESERVED' }));
      const res = await request(app).delete(`${base}/U-2026-000001`).set(authHeader('LAB_TECH'));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NOT_RESERVED');
    });
  });

  describe('POST /:idOrCode/crossmatch (F-042 guard)', () => {
    it('returns 409 when the unit is reserved for another request', async () => {
      requestService.recordCrossmatch.mockRejectedValue(
        serviceError(409, 'reserved elsewhere', { code: 'RESERVED_FOR_OTHER_REQUEST' })
      );
      const res = await request(app)
        .post('/api/blood-requests/R-000001/crossmatch')
        .set(authHeader('LAB_TECH'))
        .send({ unitCode: 'U-2026-000001', result: 'COMPATIBLE' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RESERVED_FOR_OTHER_REQUEST');
    });
  });
});
