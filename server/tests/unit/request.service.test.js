const {
  validateBloodRequestInput,
  submitBloodRequest,
  getBloodRequests,
  getBloodRequestById,
  recordCrossmatch,
  checkIssuanceReadiness,
  getCrossmatchesForRequest,
  issueUnitForRequest,
  getIssuancesForRequest,
  planReservation,
} = require('../../src/modules/request/request.service');

describe('TC-Req-01: BBMS-F-040 Blood Request Service (Unit)', () => {
  const validPayload = {
    patientName: 'Aarav Patel',
    patientBloodGroup: 'B+',
    component: 'PRBC',
    unitsRequested: 2,
    priority: 'ROUTINE',
    requiredBy: '2026-11-20T10:00:00.000Z',
  };

  describe('validateBloodRequestInput', () => {
    it('accepts a fully valid blood request payload', () => {
      const result = validateBloodRequestInput(validPayload);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual({});
      expect(result.data.patientName).toBe('Aarav Patel');
      expect(result.data.patientBloodGroup).toBe('B+');
      expect(result.data.component).toBe('PRBC');
      expect(result.data.unitsRequested).toBe(2);
      expect(result.data.priority).toBe('ROUTINE');
      expect(result.data.requiredBy).toBe('2026-11-20T10:00:00.000Z');
    });

    describe('TC-Req-04: BBMS-F-043 chain of custody (unit)', () => {
      const request = {
        id: 8,
        requestCode: 'R-000008',
        hospitalUserId: 5,
        status: 'PENDING',
        unitsRequested: 1,
      };
      const lockedRequest = {
        id: 8,
        request_code: 'R-000008',
        status: 'PENDING',
        units_requested: 1,
        patient_blood_group: 'A+',
        component: 'PRBC',
      };
      const unit = {
        id: 41,
        unit_code: 'U-2026-000041',
        component: 'PRBC',
        blood_group: 'O-',
        status: 'AVAILABLE',
        reservation_active: false,
      };
      const issued = {
        id: 5,
        requestId: 8,
        requestCode: 'R-000008',
        unitId: 41,
        unitCode: 'U-2026-000041',
        crossmatchId: 12,
        issuedBy: 3,
        issuerName: 'Labtech 1',
        issuedAt: '2026-11-12T10:00:00.000Z',
        receivedBy: 'City Hospital Desk',
      };

      it('requires the recipient and unit code before attempting issuance', async () => {
        const repository = { findByIdOrCode: jest.fn(), issueUnit: jest.fn() };
        await expect(
          issueUnitForRequest({ idOrCode: request.requestCode, body: {}, user: { id: 3 } }, repository)
        ).rejects.toMatchObject({ status: 400, errors: expect.objectContaining({ receivedBy: expect.any(String) }) });
        expect(repository.issueUnit).not.toHaveBeenCalled();
      });

      it('records an issuance only after a compatible cross-match and returns linked custody details', async () => {
        const repository = {
          findByIdOrCode: jest.fn().mockResolvedValue(request),
          issueUnit: jest.fn(async (params, plan) => {
            plan({
              request: lockedRequest,
              unit,
              isReleasable: true,
              crossmatch: { id: 12, result: 'COMPATIBLE' },
              issuedCount: 0,
            });
            expect(params).toEqual({
              requestId: 8,
              unitCode: unit.unit_code,
              userId: 3,
              receivedBy: 'City Hospital Desk',
            });
            return { issuance: issued, requestStatus: 'ISSUED' };
          }),
        };

        const result = await issueUnitForRequest({
          idOrCode: request.requestCode,
          body: { unitCode: unit.unit_code, receivedBy: '  City Hospital Desk  ' },
          user: { id: 3 },
        }, repository);

        expect(result.request.status).toBe('ISSUED');
        expect(result.issuance).toEqual(issued);
      });

      it('blocks issue when no compatible cross-match exists', async () => {
        const repository = {
          findByIdOrCode: jest.fn().mockResolvedValue(request),
          issueUnit: jest.fn((params, plan) => plan({
            request: lockedRequest,
            unit,
            isReleasable: true,
            crossmatch: null,
            issuedCount: 0,
          })),
        };
        await expect(
          issueUnitForRequest({
            idOrCode: request.requestCode,
            body: { unitCode: unit.unit_code, receivedBy: 'City Hospital Desk' },
            user: { id: 3 },
          }, repository)
        ).rejects.toMatchObject({ status: 422, code: 'NO_CROSSMATCH' });
      });

      it('does not issue unknown-group fallback units for non-emergency requests', async () => {
        const repository = {
          findByIdOrCode: jest.fn().mockResolvedValue(request),
          issueUnit: jest.fn((params, plan) => plan({
            request: { ...lockedRequest, patient_blood_group: null, priority: 'ROUTINE' },
            unit,
            isReleasable: true,
            crossmatch: { id: 12, result: 'COMPATIBLE' },
            issuedCount: 0,
          })),
        };
        await expect(
          issueUnitForRequest({
            idOrCode: request.requestCode,
            body: { unitCode: unit.unit_code, receivedBy: 'City Hospital Desk' },
            user: { id: 3 },
          }, repository)
        ).rejects.toMatchObject({ status: 422, code: 'EMERGENCY_FALLBACK_REQUIRED' });
      });

      it('allows unknown-group O-negative PRBC issuance for an emergency after cross-match', async () => {
        const repository = {
          findByIdOrCode: jest.fn().mockResolvedValue(request),
          issueUnit: jest.fn((params, plan) => {
            plan({
              request: { ...lockedRequest, patient_blood_group: null, priority: 'EMERGENCY' },
              unit,
              isReleasable: true,
              crossmatch: { id: 12, result: 'COMPATIBLE' },
              issuedCount: 0,
            });
            return { issuance: issued, requestStatus: 'ISSUED' };
          }),
        };
        await expect(
          issueUnitForRequest({
            idOrCode: request.requestCode,
            body: { unitCode: unit.unit_code, receivedBy: 'City Hospital Desk' },
            user: { id: 3 },
          }, repository)
        ).resolves.toMatchObject({ request: { status: 'ISSUED' } });
      });

      it('counts issued units against future reservation capacity', () => {
        const reserveAfterPartialIssue = () => planReservation({
          request: {
            id: 8,
            request_code: request.requestCode,
            status: 'PENDING',
            units_requested: 2,
            patient_blood_group: 'A+',
            component: 'PRBC',
          },
          unit: { ...unit, reservation_active: false },
          isReleasable: true,
          crossmatch: { id: 12, result: 'COMPATIBLE' },
          activeCount: 1,
          issuedCount: 1,
        });
        try {
          reserveAfterPartialIssue();
          throw new Error('Expected reservation to be rejected');
        } catch (error) {
          expect(error).toMatchObject({ status: 409, code: 'RESERVATION_LIMIT_REACHED' });
        }
      });

      it('returns issuance history only after applying request tenancy checks', async () => {
        const repository = {
          findByIdOrCode: jest.fn().mockResolvedValue(request),
          listIssuancesForRequest: jest.fn().mockResolvedValue([issued]),
        };
        const result = await getIssuancesForRequest(
          request.requestCode,
          { id: 5, role: 'HOSPITAL' },
          repository
        );
        expect(result.issuances).toEqual([issued]);
        expect(repository.listIssuancesForRequest).toHaveBeenCalledWith(request.id);
      });
    });

    it('defaults priority to ROUTINE when omitted', () => {
      const { priority, ...withoutPriority } = validPayload;
      const result = validateBloodRequestInput(withoutPriority);
      expect(result.isValid).toBe(true);
      expect(result.data.priority).toBe('ROUTINE');
    });

    it('allows quantity as an alias for unitsRequested', () => {
      const payload = {
        patientName: 'Pooja Nair',
        patientBloodGroup: 'O+',
        component: 'FFP',
        quantity: 3,
      };
      const result = validateBloodRequestInput(payload);
      expect(result.isValid).toBe(true);
      expect(result.data.unitsRequested).toBe(3);
    });

    it('validates and accepts all 8 ABO/Rh blood groups', () => {
      const groups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      groups.forEach((bg) => {
        const result = validateBloodRequestInput({ ...validPayload, patientBloodGroup: bg.toLowerCase() });
        expect(result.isValid).toBe(true);
        expect(result.data.patientBloodGroup).toBe(bg);
      });
    });

    it('validates and accepts all 5 blood components', () => {
      const components = ['WHOLE_BLOOD', 'PRBC', 'FFP', 'PLATELETS', 'CRYO'];
      components.forEach((comp) => {
        const result = validateBloodRequestInput({ ...validPayload, component: comp.toLowerCase() });
        expect(result.isValid).toBe(true);
        expect(result.data.component).toBe(comp);
      });
    });

    it('validates and accepts all 3 priority levels', () => {
      const priorities = ['ROUTINE', 'URGENT', 'EMERGENCY'];
      priorities.forEach((p) => {
        const result = validateBloodRequestInput({ ...validPayload, priority: p });
        expect(result.isValid).toBe(true);
        expect(result.data.priority).toBe(p);
      });
    });

    it('rejects missing or empty patient name', () => {
      const result = validateBloodRequestInput({ ...validPayload, patientName: '   ' });
      expect(result.isValid).toBe(false);
      expect(result.errors.patientName).toMatch(/required/i);
    });

    it('rejects patient name longer than 100 characters', () => {
      const longName = 'A'.repeat(101);
      const result = validateBloodRequestInput({ ...validPayload, patientName: longName });
      expect(result.isValid).toBe(false);
      expect(result.errors.patientName).toMatch(/100 characters/i);
    });

    it('rejects invalid blood group', () => {
      const result = validateBloodRequestInput({ ...validPayload, patientBloodGroup: 'XYZ+' });
      expect(result.isValid).toBe(false);
      expect(result.errors.patientBloodGroup).toMatch(/Valid patient blood group is required/i);
    });

    it('accepts UNKNOWN blood group and normalizes it to null', () => {
      const result = validateBloodRequestInput({ ...validPayload, patientBloodGroup: 'unknown' });
      expect(result.isValid).toBe(true);
      expect(result.data.patientBloodGroup).toBeNull();
    });

    it('rejects invalid blood component', () => {
      const result = validateBloodRequestInput({ ...validPayload, component: 'PLASMA_SPECIAL' });
      expect(result.isValid).toBe(false);
      expect(result.errors.component).toMatch(/Valid component is required/i);
    });

    it.each([0, -1, 21, 1.5, 'two', null, undefined])(
      'rejects invalid unitsRequested: %s',
      (invalidUnits) => {
        const result = validateBloodRequestInput({ ...validPayload, unitsRequested: invalidUnits });
        expect(result.isValid).toBe(false);
        expect(result.errors.unitsRequested).toMatch(/whole number between 1 and 20/i);
      }
    );

    it('rejects invalid priority string', () => {
      const result = validateBloodRequestInput({ ...validPayload, priority: 'SUPER_FAST' });
      expect(result.isValid).toBe(false);
      expect(result.errors.priority).toMatch(/ROUTINE, URGENT, or EMERGENCY/i);
    });

    it('rejects malformed requiredBy date', () => {
      const result = validateBloodRequestInput({ ...validPayload, requiredBy: 'invalid-date' });
      expect(result.isValid).toBe(false);
      expect(result.errors.requiredBy).toMatch(/valid date or datetime/i);
    });
  });

  describe('submitBloodRequest', () => {
    it('creates a request and returns the created record with PENDING status', async () => {
      const mockRepo = {
        createRequest: jest.fn().mockImplementation(async (data) => ({
          id: 42,
          requestCode: 'R-000042',
          ...data,
          createdAt: new Date().toISOString(),
          hospital: { id: data.hospitalUserId, fullName: 'City Hospital Desk', organisation: 'City Hospital' },
        })),
      };

      const result = await submitBloodRequest(validPayload, 5, mockRepo);

      expect(mockRepo.createRequest).toHaveBeenCalledTimes(1);
      expect(mockRepo.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          hospitalUserId: 5,
          patientName: 'Aarav Patel',
          patientBloodGroup: 'B+',
          component: 'PRBC',
          unitsRequested: 2,
          priority: 'ROUTINE',
          status: 'PENDING',
        })
      );
      expect(result.id).toBe(42);
      expect(result.requestCode).toBe('R-000042');
      expect(result.status).toBe('PENDING');
    });

    it('throws 400 when hospitalUserId is missing', async () => {
      const mockRepo = { createRequest: jest.fn() };
      await expect(submitBloodRequest(validPayload, null, mockRepo)).rejects.toMatchObject({
        status: 400,
        message: /hospitalUserId is required/i,
      });
      expect(mockRepo.createRequest).not.toHaveBeenCalled();
    });

    it('throws 400 with validation errors when input is invalid', async () => {
      const mockRepo = { createRequest: jest.fn() };
      await expect(
        submitBloodRequest({ patientName: '' }, 5, mockRepo)
      ).rejects.toMatchObject({
        status: 400,
        errors: expect.objectContaining({ patientName: expect.any(String) }),
      });
      expect(mockRepo.createRequest).not.toHaveBeenCalled();
    });
  });

  describe('getBloodRequests', () => {
    it('scopes list to hospitalUserId when role is HOSPITAL', async () => {
      const mockRepo = { listRequests: jest.fn().mockResolvedValue([{ id: 1, requestCode: 'R-000001' }]) };
      const hospitalUser = { id: 5, role: 'HOSPITAL' };

      const result = await getBloodRequests({ user: hospitalUser }, mockRepo);

      expect(mockRepo.listRequests).toHaveBeenCalledWith({
        hospitalUserId: 5,
        status: null,
        priority: null,
      });
      expect(result).toHaveLength(1);
    });

    it('does not filter by hospitalUserId when role is ADMIN or MANAGER', async () => {
      const mockRepo = { listRequests: jest.fn().mockResolvedValue([]) };
      const adminUser = { id: 1, role: 'ADMIN' };

      await getBloodRequests({ user: adminUser }, mockRepo);

      expect(mockRepo.listRequests).toHaveBeenCalledWith({
        hospitalUserId: null,
        status: null,
        priority: null,
      });
    });

    it('passes status and priority filters to repository', async () => {
      const mockRepo = { listRequests: jest.fn().mockResolvedValue([]) };
      const managerUser = { id: 2, role: 'MANAGER' };

      await getBloodRequests({ user: managerUser, status: 'pending', priority: 'emergency' }, mockRepo);

      expect(mockRepo.listRequests).toHaveBeenCalledWith({
        hospitalUserId: null,
        status: 'PENDING',
        priority: 'EMERGENCY',
      });
    });

    it('throws 400 when invalid status filter is passed', async () => {
      const mockRepo = { listRequests: jest.fn() };
      await expect(
        getBloodRequests({ user: { id: 1, role: 'ADMIN' }, status: 'UNKNOWN' }, mockRepo)
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('getBloodRequestById', () => {
    it('returns request if found and user is authorized', async () => {
      const mockRequest = { id: 1, requestCode: 'R-000001', hospitalUserId: 5 };
      const mockRepo = { findByIdOrCode: jest.fn().mockResolvedValue(mockRequest) };

      const result = await getBloodRequestById('R-000001', { id: 5, role: 'HOSPITAL' }, mockRepo);
      expect(result).toEqual(mockRequest);
    });

    it('throws 404 when request is not found', async () => {
      const mockRepo = { findByIdOrCode: jest.fn().mockResolvedValue(null) };
      await expect(
        getBloodRequestById('R-999999', { id: 5, role: 'HOSPITAL' }, mockRepo)
      ).rejects.toMatchObject({ status: 404 });
    });

    it('throws 403 when hospital user attempts to view another hospital request', async () => {
      const mockRequest = { id: 1, requestCode: 'R-000001', hospitalUserId: 99 };
      const mockRepo = { findByIdOrCode: jest.fn().mockResolvedValue(mockRequest) };

      await expect(
        getBloodRequestById('R-000001', { id: 5, role: 'HOSPITAL' }, mockRepo)
      ).rejects.toMatchObject({
        status: 403,
        message: /belongs to another hospital/i,
      });
    });

    it('allows ADMIN or MANAGER to view any hospital request', async () => {
      const mockRequest = { id: 1, requestCode: 'R-000001', hospitalUserId: 99 };
      const mockRepo = { findByIdOrCode: jest.fn().mockResolvedValue(mockRequest) };

      const result = await getBloodRequestById('R-000001', { id: 1, role: 'ADMIN' }, mockRepo);
      expect(result).toEqual(mockRequest);
    });
  });

  describe('TC-Req-02: BBMS-F-041 Crossmatch & Issuance Readiness', () => {
    const mockRequest = {
      id: 1,
      requestCode: 'R-000001',
      hospitalUserId: 5,
      patientName: 'Kavita Rao',
      patientBloodGroup: 'A+',
      component: 'PRBC',
      unitsRequested: 1,
      status: 'PENDING',
    };

    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const mockUnit = {
      id: 10,
      unit_code: 'U-000001',
      blood_group: 'O-',
      component: 'PRBC',
      status: 'AVAILABLE',
      expires_at: futureDate,
    };

    describe('recordCrossmatch', () => {
      it('successfully records a COMPATIBLE crossmatch for compatible blood groups', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue(mockUnit),
          createCrossmatch: jest.fn().mockResolvedValue({
            id: 42,
            performedAt: '2026-11-12T00:00:00.000Z',
          }),
        };

        const result = await recordCrossmatch(
          { idOrCode: 'R-000001', unitCode: 'U-000001', result: 'COMPATIBLE', performedBy: 3 },
          mockRepo
        );

        expect(result).toMatchObject({
          id: 42,
          requestId: 1,
          requestCode: 'R-000001',
          unitId: 10,
          unitCode: 'U-000001',
          result: 'COMPATIBLE',
          readyForIssuance: true,
          performedBy: 3,
        });

        expect(mockRepo.createCrossmatch).toHaveBeenCalledWith({
          requestId: 1,
          unitId: 10,
          result: 'COMPATIBLE',
          performedBy: 3,
        });
      });

      it('successfully records an INCOMPATIBLE crossmatch and marks readyForIssuance false', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue(mockUnit),
          createCrossmatch: jest.fn().mockResolvedValue({
            id: 43,
            performedAt: '2026-11-12T00:00:00.000Z',
          }),
        };

        const result = await recordCrossmatch(
          { idOrCode: 'R-000001', unitCode: 'U-000001', result: 'INCOMPATIBLE', performedBy: 3 },
          mockRepo
        );

        expect(result.result).toBe('INCOMPATIBLE');
        expect(result.readyForIssuance).toBe(false);
      });

      it('throws 400 when idOrCode is missing', async () => {
        await expect(
          recordCrossmatch({ idOrCode: '', unitCode: 'U-000001', result: 'COMPATIBLE', performedBy: 3 })
        ).rejects.toMatchObject({ status: 400, message: /request id or code is required/i });
      });

      it('throws 400 when unitCode is missing or empty', async () => {
        await expect(
          recordCrossmatch({ idOrCode: 'R-000001', unitCode: '   ', result: 'COMPATIBLE', performedBy: 3 })
        ).rejects.toMatchObject({ status: 400, message: /unit code is required/i });
      });

      it('throws 400 when result is invalid', async () => {
        await expect(
          recordCrossmatch({ idOrCode: 'R-000001', unitCode: 'U-000001', result: 'MAYBE', performedBy: 3 })
        ).rejects.toMatchObject({ status: 400, message: /result must be COMPATIBLE or INCOMPATIBLE/i });
      });

      it('throws 404 when request is not found', async () => {
        const mockRepo = { findByIdOrCode: jest.fn().mockResolvedValue(null) };
        await expect(
          recordCrossmatch({ idOrCode: 'R-999999', unitCode: 'U-000001', result: 'COMPATIBLE', performedBy: 3 }, mockRepo)
        ).rejects.toMatchObject({ status: 404, message: /not found/i });
      });

      it('throws 404 when unit is not found', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue(null),
        };
        await expect(
          recordCrossmatch({ idOrCode: 'R-000001', unitCode: 'U-999999', result: 'COMPATIBLE', performedBy: 3 }, mockRepo)
        ).rejects.toMatchObject({ status: 404, message: /not found/i });
      });

      it('throws 422 when request is CANCELLED or REJECTED', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue({ ...mockRequest, status: 'CANCELLED' }),
          findUnitByCode: jest.fn().mockResolvedValue(mockUnit),
        };
        await expect(
          recordCrossmatch({ idOrCode: 'R-000001', unitCode: 'U-000001', result: 'COMPATIBLE', performedBy: 3 }, mockRepo)
        ).rejects.toMatchObject({ status: 422, message: /cancelled/i });
      });

      it('throws 422 when blood unit is in QUARANTINE', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue({ ...mockUnit, status: 'QUARANTINE' }),
        };
        await expect(
          recordCrossmatch({ idOrCode: 'R-000001', unitCode: 'U-000001', result: 'COMPATIBLE', performedBy: 3 }, mockRepo)
        ).rejects.toMatchObject({ status: 422, message: /quarantine/i });
      });

      it('throws 422 when blood unit is DISCARDED', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue({ ...mockUnit, status: 'DISCARDED' }),
        };
        await expect(
          recordCrossmatch({ idOrCode: 'R-000001', unitCode: 'U-000001', result: 'COMPATIBLE', performedBy: 3 }, mockRepo)
        ).rejects.toMatchObject({ status: 422, message: /discarded/i });
      });

      it('throws 422 when blood unit has expired', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue({ ...mockUnit, expires_at: pastDate }),
        };
        await expect(
          recordCrossmatch({ idOrCode: 'R-000001', unitCode: 'U-000001', result: 'COMPATIBLE', performedBy: 3 }, mockRepo)
        ).rejects.toMatchObject({ status: 422, message: /expired/i });
      });

      it('throws 422 when attempting to record COMPATIBLE for clinically incompatible ABO blood groups', async () => {
        // Patient is A+, donor unit is B+
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest), // Patient is A+
          findUnitByCode: jest.fn().mockResolvedValue({ ...mockUnit, blood_group: 'B+' }),
        };
        await expect(
          recordCrossmatch({ idOrCode: 'R-000001', unitCode: 'U-000001', result: 'COMPATIBLE', performedBy: 3 }, mockRepo)
        ).rejects.toMatchObject({
          status: 422,
          message: /clinically incompatible/i,
        });
      });

      it('does not mark an unknown-group non-emergency request compatible with O-negative blood', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue({
            ...mockRequest,
            patientBloodGroup: null,
            priority: 'ROUTINE',
          }),
          findUnitByCode: jest.fn().mockResolvedValue(mockUnit),
          createCrossmatch: jest.fn(),
        };
        await expect(
          recordCrossmatch(
            { idOrCode: 'R-000001', unitCode: 'U-000001', result: 'COMPATIBLE', performedBy: 3 },
            mockRepo
          )
        ).rejects.toMatchObject({ status: 422, code: 'EMERGENCY_FALLBACK_REQUIRED' });
        expect(mockRepo.createCrossmatch).not.toHaveBeenCalled();
      });

      it('allows recording INCOMPATIBLE even when ABO blood groups are clinically incompatible', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue({ ...mockUnit, blood_group: 'B+' }),
          createCrossmatch: jest.fn().mockResolvedValue({ id: 45, performedAt: '2026-11-12T00:00:00.000Z' }),
        };

        const result = await recordCrossmatch(
          { idOrCode: 'R-000001', unitCode: 'U-000001', result: 'INCOMPATIBLE', performedBy: 3 },
          mockRepo
        );

        expect(result.result).toBe('INCOMPATIBLE');
        expect(result.readyForIssuance).toBe(false);
      });
    });

    describe('checkIssuanceReadiness', () => {
      it('blocks issuance when no crossmatch has been recorded', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue(mockUnit),
          findLatestCrossmatch: jest.fn().mockResolvedValue(null),
        };

        const status = await checkIssuanceReadiness({ idOrCode: 'R-000001', unitCode: 'U-000001' }, mockRepo);
        expect(status.readyForIssuance).toBe(false);
        expect(status.error).toBe('NO_CROSSMATCH');
        expect(status.message).toMatch(/issuance is blocked/i);
      });

      it('blocks issuance when latest crossmatch is INCOMPATIBLE', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue(mockUnit),
          findLatestCrossmatch: jest.fn().mockResolvedValue({
            id: 101,
            result: 'INCOMPATIBLE',
            performedAt: '2026-11-12T00:00:00.000Z',
          }),
        };

        const status = await checkIssuanceReadiness({ idOrCode: 'R-000001', unitCode: 'U-000001' }, mockRepo);
        expect(status.readyForIssuance).toBe(false);
        expect(status.error).toBe('INCOMPATIBLE_CROSSMATCH');
        expect(status.message).toMatch(/issuance is blocked/i);
      });

      it('blocks issuance when unit is expired even if crossmatch was COMPATIBLE', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue({ ...mockUnit, expires_at: pastDate }),
          findLatestCrossmatch: jest.fn().mockResolvedValue({
            id: 102,
            result: 'COMPATIBLE',
            performedAt: '2026-11-12T00:00:00.000Z',
          }),
        };

        const status = await checkIssuanceReadiness({ idOrCode: 'R-000001', unitCode: 'U-000001' }, mockRepo);
        expect(status.readyForIssuance).toBe(false);
        expect(status.error).toBe('EXPIRED_UNIT');
      });

      it('permits issuance when crossmatch is COMPATIBLE and unit is active and unexpired', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          findUnitByCode: jest.fn().mockResolvedValue(mockUnit),
          findLatestCrossmatch: jest.fn().mockResolvedValue({
            id: 103,
            result: 'COMPATIBLE',
            performedAt: '2026-11-12T00:00:00.000Z',
          }),
        };

        const status = await checkIssuanceReadiness({ idOrCode: 'R-000001', unitCode: 'U-000001' }, mockRepo);
        expect(status.readyForIssuance).toBe(true);
        expect(status.crossmatchId).toBe(103);
        expect(status.result).toBe('COMPATIBLE');
        expect(status.message).toMatch(/ready for issuance/i);
      });
    });

    describe('getCrossmatchesForRequest', () => {
      it('returns request and crossmatches list for authorized hospital', async () => {
        const mockCrossmatches = [
          {
            id: 1,
            unitCode: 'U-000001',
            result: 'COMPATIBLE',
            readyForIssuance: true,
          },
        ];
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue(mockRequest),
          listCrossmatchesForRequest: jest.fn().mockResolvedValue(mockCrossmatches),
        };

        const result = await getCrossmatchesForRequest('R-000001', { id: 5, role: 'HOSPITAL' }, mockRepo);
        expect(result.request).toEqual(mockRequest);
        expect(result.crossmatches).toEqual(mockCrossmatches);
      });

      it('throws 403 when hospital tries to view another hospital crossmatches', async () => {
        const mockRepo = {
          findByIdOrCode: jest.fn().mockResolvedValue({ ...mockRequest, hospitalUserId: 99 }),
        };

        await expect(
          getCrossmatchesForRequest('R-000001', { id: 5, role: 'HOSPITAL' }, mockRepo)
        ).rejects.toMatchObject({ status: 403 });
      });
    });
  });
});
