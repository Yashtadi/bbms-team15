const {
  validateBloodRequestInput,
  submitBloodRequest,
  getBloodRequests,
  getBloodRequestById,
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
});
