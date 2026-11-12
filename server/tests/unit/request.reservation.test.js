const {
  DEFAULT_HOLD_MINUTES,
  getDefaultHoldMinutes,
  isHeldForAnotherRequest,
  validateReservationInput,
  planReservation,
  reserveUnitForRequest,
  releaseUnitReservation,
  getReservationsForRequest,
  startReservationExpirySweep,
  recordCrossmatch,
  checkIssuanceReadiness,
} = require('../../src/modules/request/request.service');

// A pending A+ PRBC request for one unit, as the locked blood_requests row
const lockedRequest = (overrides = {}) => ({
  id: 7,
  request_code: 'R-000007',
  patient_blood_group: 'A+',
  component: 'PRBC',
  units_requested: 1,
  status: 'PENDING',
  ...overrides,
});

// An available O- PRBC unit, as the locked blood_units row
const lockedUnit = (overrides = {}) => ({
  id: 41,
  unit_code: 'U-2026-000041',
  component: 'PRBC',
  blood_group: 'O-',
  status: 'AVAILABLE',
  reserved_for_request_id: null,
  reserved_until: null,
  reservation_active: false,
  ...overrides,
});

const compatibleCrossmatch = { id: 9, result: 'COMPATIBLE' };

const planContext = (overrides = {}) => ({
  request: lockedRequest(),
  unit: lockedUnit(),
  isReleasable: true,
  crossmatch: compatibleCrossmatch,
  activeCount: 0,
  ...overrides,
});

const expectRefusal = (context, status, code) => {
  let thrown;
  try {
    planReservation(context);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  expect(thrown.status).toBe(status);
  expect(thrown.code).toBe(code);
};

describe('TC-Req-03: BBMS-F-042 reservation hold window (unit)', () => {
  describe('getDefaultHoldMinutes', () => {
    it('defaults to 120 minutes when RESERVATION_HOLD_MINUTES is not set', () => {
      expect(getDefaultHoldMinutes({})).toBe(DEFAULT_HOLD_MINUTES);
      expect(DEFAULT_HOLD_MINUTES).toBe(120);
    });

    it('uses a valid configured value', () => {
      expect(getDefaultHoldMinutes({ RESERVATION_HOLD_MINUTES: '45' })).toBe(45);
    });

    it.each(['14', '1441', 'abc', '30.5', '-5'])('falls back to 120 for invalid config %s', (value) => {
      expect(getDefaultHoldMinutes({ RESERVATION_HOLD_MINUTES: value })).toBe(120);
    });
  });

  describe('validateReservationInput', () => {
    it('accepts a unit code and uses the default hold when holdMinutes is omitted', () => {
      const result = validateReservationInput({ unitCode: ' u-2026-000041 ' }, {});
      expect(result.isValid).toBe(true);
      expect(result.data).toEqual({ unitCode: 'U-2026-000041', holdMinutes: 120 });
    });

    it('rejects a missing unit code', () => {
      const result = validateReservationInput({}, {});
      expect(result.isValid).toBe(false);
      expect(result.errors.unitCode).toMatch(/required/i);
    });

    it.each([
      [15, true],
      [1440, true],
      ['60', true],
      [14, false],
      [1441, false],
      [30.5, false],
      ['soon', false],
      [true, false],
    ])('holdMinutes %p -> valid %p (boundaries 15 and 1440)', (holdMinutes, valid) => {
      const result = validateReservationInput({ unitCode: 'U-2026-000041', holdMinutes }, {});
      expect(result.isValid).toBe(valid);
      if (valid) {
        expect(result.data.holdMinutes).toBe(Number(holdMinutes));
      } else {
        expect(result.errors.holdMinutes).toMatch(/between 15 and 1440/);
      }
    });
  });

  describe('planReservation', () => {
    it('allows a compatible, available, cross-matched unit on a pending request', () => {
      expect(() => planReservation(planContext())).not.toThrow();
    });

    it('allows adding a second hold to a request that still needs units (boundary: activeCount = units - 1)', () => {
      const context = planContext({ request: lockedRequest({ units_requested: 2 }), activeCount: 1 });
      expect(() => planReservation(context)).not.toThrow();
    });

    it.each(['ISSUED', 'REJECTED', 'CANCELLED'])('refuses a %s request with 409', (status) => {
      expectRefusal(planContext({ request: lockedRequest({ status }) }), 409, 'REQUEST_NOT_RESERVABLE');
    });

    it('refuses once every requested unit is already held (boundary: activeCount = units)', () => {
      expectRefusal(planContext({ activeCount: 1 }), 409, 'RESERVATION_LIMIT_REACHED');
    });

    it('refuses a unit actively held for another request with 409', () => {
      const unit = lockedUnit({ status: 'RESERVED', reserved_for_request_id: 99, reservation_active: true });
      expectRefusal(planContext({ unit, isReleasable: false }), 409, 'RESERVED_FOR_OTHER_REQUEST');
    });

    it('refuses a unit already held for this request with 409', () => {
      const unit = lockedUnit({ status: 'RESERVED', reserved_for_request_id: 7, reservation_active: true });
      expectRefusal(planContext({ unit, isReleasable: false }), 409, 'ALREADY_RESERVED');
    });

    it('allows taking over a unit whose hold for another request has lapsed', () => {
      const unit = lockedUnit({ status: 'RESERVED', reserved_for_request_id: 99, reservation_active: false });
      expect(() => planReservation(planContext({ unit, isReleasable: true }))).not.toThrow();
    });

    it('refuses a unit of a different component with 422', () => {
      expectRefusal(planContext({ unit: lockedUnit({ component: 'FFP' }) }), 422, 'COMPONENT_MISMATCH');
    });

    it('refuses a unit that is not releasable stock (quarantine, expired, untested) with 409', () => {
      expectRefusal(planContext({ unit: lockedUnit({ status: 'QUARANTINE' }), isReleasable: false }), 409, 'UNIT_NOT_AVAILABLE');
    });

    it('refuses a unit with no cross-match with 422', () => {
      expectRefusal(planContext({ crossmatch: null }), 422, 'NO_CROSSMATCH');
    });

    it('refuses a unit whose latest cross-match is INCOMPATIBLE with 422', () => {
      expectRefusal(planContext({ crossmatch: { id: 3, result: 'INCOMPATIBLE' } }), 422, 'INCOMPATIBLE_CROSSMATCH');
    });

    it('refuses a clinically incompatible blood group with 422', () => {
      expectRefusal(planContext({ unit: lockedUnit({ blood_group: 'B+' }) }), 422, 'INCOMPATIBLE_BLOOD_GROUP');
    });
  });

  describe('isHeldForAnotherRequest', () => {
    it('is true only for an active hold on a different request', () => {
      expect(isHeldForAnotherRequest(lockedUnit({ status: 'RESERVED', reserved_for_request_id: 2, reservation_active: 1 }), 1)).toBe(true);
      expect(isHeldForAnotherRequest(lockedUnit({ status: 'RESERVED', reserved_for_request_id: 2, reservation_active: 0 }), 1)).toBe(false);
      expect(isHeldForAnotherRequest(lockedUnit({ status: 'RESERVED', reserved_for_request_id: 1, reservation_active: 1 }), 1)).toBe(false);
      expect(isHeldForAnotherRequest(lockedUnit({ status: 'AVAILABLE' }), 1)).toBe(false);
      expect(isHeldForAnotherRequest(null, 1)).toBe(false);
    });
  });
});

describe('TC-Req-03: BBMS-F-042 reservation service (unit, mocked repository)', () => {
  const mappedRequest = {
    id: 7,
    requestCode: 'R-000007',
    unitsRequested: 1,
    patientBloodGroup: 'A+',
    component: 'PRBC',
    status: 'PENDING',
    hospitalUserId: 5,
  };
  const staff = { id: 3, role: 'LAB_TECH' };
  let repo;

  beforeEach(() => {
    repo = {
      findByIdOrCode: jest.fn().mockResolvedValue(mappedRequest),
      releaseExpiredReservations: jest.fn().mockResolvedValue([]),
      reserveUnit: jest.fn(),
      releaseReservation: jest.fn(),
      listReservationsForRequest: jest.fn().mockResolvedValue([]),
    };
  });

  describe('reserveUnitForRequest', () => {
    it('sweeps lapsed holds, then reserves through the repository with the business rules', async () => {
      repo.reserveUnit.mockResolvedValue({
        request: { ...lockedRequest(), status: 'RESERVED' },
        unit: lockedUnit(),
        crossmatchId: 9,
        reservedUntil: new Date('2026-11-12T12:00:00.000Z'),
        secondsRemaining: 7200,
        activeReservations: 1,
      });

      const result = await reserveUnitForRequest(
        { idOrCode: 'R-000007', body: { unitCode: 'u-2026-000041', holdMinutes: 30 }, user: staff },
        repo
      );

      expect(repo.releaseExpiredReservations).toHaveBeenCalled();
      expect(repo.reserveUnit).toHaveBeenCalledWith(
        { requestId: 7, unitCode: 'U-2026-000041', holdMinutes: 30, userId: 3 },
        planReservation
      );
      expect(result).toMatchObject({
        requestCode: 'R-000007',
        requestStatus: 'RESERVED',
        unitCode: 'U-2026-000041',
        holdMinutes: 30,
        reservedUntil: '2026-11-12T12:00:00.000Z',
        secondsRemaining: 7200,
        activeReservations: 1,
      });
    });

    it('returns 400 with field errors for invalid input, before touching the repository', async () => {
      await expect(
        reserveUnitForRequest({ idOrCode: 'R-000007', body: { holdMinutes: 5 }, user: staff }, repo)
      ).rejects.toMatchObject({ status: 400, errors: { unitCode: expect.any(String), holdMinutes: expect.any(String) } });
      expect(repo.findByIdOrCode).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown request', async () => {
      repo.findByIdOrCode.mockResolvedValue(null);
      await expect(
        reserveUnitForRequest({ idOrCode: 'R-999999', body: { unitCode: 'U-2026-000041' }, user: staff }, repo)
      ).rejects.toMatchObject({ status: 404 });
      expect(repo.reserveUnit).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown unit', async () => {
      repo.reserveUnit.mockResolvedValue({ unitNotFound: true });
      await expect(
        reserveUnitForRequest({ idOrCode: 'R-000007', body: { unitCode: 'U-2026-999999' }, user: staff }, repo)
      ).rejects.toMatchObject({ status: 404, message: expect.stringMatching(/U-2026-999999/) });
    });

    it('passes on a business-rule refusal from the locked transaction', async () => {
      repo.reserveUnit.mockImplementation(async (params, plan) => {
        plan(planContext({ crossmatch: null }));
      });
      await expect(
        reserveUnitForRequest({ idOrCode: 'R-000007', body: { unitCode: 'U-2026-000041' }, user: staff }, repo)
      ).rejects.toMatchObject({ status: 422, code: 'NO_CROSSMATCH' });
    });
  });

  describe('releaseUnitReservation', () => {
    it('releases a held unit and reports the new request status', async () => {
      repo.releaseReservation.mockResolvedValue({
        request: { ...lockedRequest(), status: 'PENDING' },
        unit: { ...lockedUnit(), status: 'AVAILABLE' },
      });

      const result = await releaseUnitReservation({ idOrCode: 'R-000007', unitCode: 'u-2026-000041', user: staff }, repo);

      expect(repo.releaseReservation).toHaveBeenCalledWith({ requestId: 7, unitCode: 'U-2026-000041', userId: 3 });
      expect(result).toEqual({
        requestId: 7,
        requestCode: 'R-000007',
        requestStatus: 'PENDING',
        unitCode: 'U-2026-000041',
        unitStatus: 'AVAILABLE',
      });
    });

    it('returns 409 when the unit is not held for this request', async () => {
      repo.releaseReservation.mockResolvedValue({ notReserved: true });
      await expect(
        releaseUnitReservation({ idOrCode: 'R-000007', unitCode: 'U-2026-000041', user: staff }, repo)
      ).rejects.toMatchObject({ status: 409, code: 'NOT_RESERVED' });
    });

    it('returns 404 for an unknown unit or request', async () => {
      repo.releaseReservation.mockResolvedValue({ unitNotFound: true });
      await expect(
        releaseUnitReservation({ idOrCode: 'R-000007', unitCode: 'U-2026-999999', user: staff }, repo)
      ).rejects.toMatchObject({ status: 404 });

      repo.findByIdOrCode.mockResolvedValue(null);
      await expect(
        releaseUnitReservation({ idOrCode: 'R-999999', unitCode: 'U-2026-000041', user: staff }, repo)
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('getReservationsForRequest', () => {
    it('sweeps lapsed holds before listing, so a run-out hold is never shown', async () => {
      const reservations = [{ unitCode: 'U-2026-000041', secondsRemaining: 300 }];
      repo.listReservationsForRequest.mockResolvedValue(reservations);

      const result = await getReservationsForRequest('R-000007', staff, repo);

      expect(repo.releaseExpiredReservations.mock.invocationCallOrder[0]).toBeLessThan(
        repo.listReservationsForRequest.mock.invocationCallOrder[0]
      );
      expect(result.reservations).toBe(reservations);
      expect(result.request.requestCode).toBe('R-000007');
    });

    it("forbids a hospital from viewing another hospital's reservations (403)", async () => {
      await expect(
        getReservationsForRequest('R-000007', { id: 99, role: 'HOSPITAL' }, repo)
      ).rejects.toMatchObject({ status: 403 });
      expect(repo.listReservationsForRequest).not.toHaveBeenCalled();
    });
  });

  describe('startReservationExpirySweep', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('runs the sweep on every interval and logs released units', async () => {
      const logger = { log: jest.fn(), error: jest.fn() };
      repo.releaseExpiredReservations.mockResolvedValue([{ unitCode: 'U-2026-000041', requestId: 7 }]);

      const timer = startReservationExpirySweep({ intervalMs: 1000, repository: repo, logger });
      await jest.advanceTimersByTimeAsync(2000);
      clearInterval(timer);

      expect(repo.releaseExpiredReservations).toHaveBeenCalledTimes(2);
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('U-2026-000041'));
    });

    it('logs and survives a failing sweep', async () => {
      const logger = { log: jest.fn(), error: jest.fn() };
      repo.releaseExpiredReservations.mockRejectedValue(new Error('db down'));

      const timer = startReservationExpirySweep({ intervalMs: 1000, repository: repo, logger });
      await jest.advanceTimersByTimeAsync(1000);
      clearInterval(timer);

      expect(logger.error).toHaveBeenCalledWith(expect.any(String), 'db down');
    });
  });

  describe('excluded from other allocations', () => {
    const heldElsewhere = {
      id: 41,
      unit_code: 'U-2026-000041',
      blood_group: 'O-',
      status: 'RESERVED',
      reserved_for_request_id: 99,
      reservation_active: 1,
      expires_at: new Date(Date.now() + 86400000),
    };

    it('refuses to record a cross-match against a unit held for another request (409)', async () => {
      const crossRepo = {
        findByIdOrCode: jest.fn().mockResolvedValue(mappedRequest),
        findUnitByCode: jest.fn().mockResolvedValue(heldElsewhere),
        createCrossmatch: jest.fn(),
      };
      await expect(
        recordCrossmatch({ idOrCode: 'R-000007', unitCode: 'U-2026-000041', result: 'COMPATIBLE', performedBy: 3 }, crossRepo)
      ).rejects.toMatchObject({ status: 409, code: 'RESERVED_FOR_OTHER_REQUEST' });
      expect(crossRepo.createCrossmatch).not.toHaveBeenCalled();
    });

    it('reports a unit held for another request as not ready for issuance', async () => {
      const checkRepo = {
        findByIdOrCode: jest.fn().mockResolvedValue(mappedRequest),
        findUnitByCode: jest.fn().mockResolvedValue(heldElsewhere),
        findLatestCrossmatch: jest.fn().mockResolvedValue({ id: 9, result: 'COMPATIBLE' }),
      };
      const result = await checkIssuanceReadiness({ idOrCode: 'R-000007', unitCode: 'U-2026-000041' }, checkRepo);
      expect(result.readyForIssuance).toBe(false);
      expect(result.error).toBe('RESERVED_FOR_OTHER_REQUEST');
    });

    it('treats a unit held for this same request as ready for issuance', async () => {
      const checkRepo = {
        findByIdOrCode: jest.fn().mockResolvedValue(mappedRequest),
        findUnitByCode: jest.fn().mockResolvedValue({ ...heldElsewhere, reserved_for_request_id: 7 }),
        findLatestCrossmatch: jest.fn().mockResolvedValue({ id: 9, result: 'COMPATIBLE' }),
      };
      const result = await checkIssuanceReadiness({ idOrCode: 'R-000007', unitCode: 'U-2026-000041' }, checkRepo);
      expect(result.readyForIssuance).toBe(true);
    });
  });
});
