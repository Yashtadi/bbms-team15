const {
  validateDonorRegistration,
  registerDonor,
} = require('../../src/modules/donor/donor.service');

describe('TC-Reg-01: donor registration validation (unit)', () => {
  const validPayload = {
    name: 'Suresh Raina',
    age: 28,
    gender: 'MALE',
    contact: '9876543210',
    idProof: 'AADHAAR-99990001',
    medicalHistory: 'No chronic illness',
  };

  it('accepts completely valid donor information', () => {
    const result = validateDonorRegistration(validPayload);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('rejects empty name with field-level message', () => {
    const result = validateDonorRegistration({ ...validPayload, name: '   ' });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBe('Full name is required');
  });

  it('rejects missing or empty ID proof', () => {
    const result = validateDonorRegistration({ ...validPayload, idProof: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.idProof).toBe('ID proof is required');
  });

  it('rejects invalid contact number', () => {
    const result = validateDonorRegistration({ ...validPayload, contact: '123' });
    expect(result.isValid).toBe(false);
    expect(result.errors.contact).toBe('Invalid contact number');
  });

  it('rejects empty contact number', () => {
    const result = validateDonorRegistration({ ...validPayload, contact: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.contact).toBe('Contact number is required');
  });

  describe('age boundary tests', () => {
    it('rejects age 17 (below minimum age boundary)', () => {
      const result = validateDonorRegistration({ ...validPayload, age: 17 });
      expect(result.isValid).toBe(false);
      expect(result.errors.age).toBe('Age must be between 18 and 65');
    });

    it('accepts age 18 (minimum age boundary)', () => {
      const result = validateDonorRegistration({ ...validPayload, age: 18 });
      expect(result.isValid).toBe(true);
    });

    it('accepts age 65 (maximum age boundary)', () => {
      const result = validateDonorRegistration({ ...validPayload, age: 65 });
      expect(result.isValid).toBe(true);
    });

    it('rejects age 66 (above maximum age boundary)', () => {
      const result = validateDonorRegistration({ ...validPayload, age: 66 });
      expect(result.isValid).toBe(false);
      expect(result.errors.age).toBe('Age must be between 18 and 65');
    });
  });

  it('rejects invalid gender', () => {
    const result = validateDonorRegistration({ ...validPayload, gender: 'UNKNOWN' });
    expect(result.isValid).toBe(false);
    expect(result.errors.gender).toBe('Gender must be MALE, FEMALE, or OTHER');
  });
});

describe('TC-Reg-01: registerDonor service logic (unit)', () => {
  it('throws 409 if a donor with the same ID proof is already registered', async () => {
    const mockRepo = {
      findByIdProof: jest.fn().mockResolvedValue({ id: 1, donor_code: 'D-000001' }),
      generateNextDonorCode: jest.fn(),
      createDonor: jest.fn(),
    };

    const payload = {
      name: 'Ravi Kumar',
      age: 30,
      gender: 'MALE',
      contact: '9876543210',
      idProof: 'DUPLICATE-ID-01',
    };

    await expect(registerDonor(payload, mockRepo)).rejects.toMatchObject({
      status: 409,
      message: 'A donor with this ID proof is already registered',
    });

    expect(mockRepo.findByIdProof).toHaveBeenCalledWith('DUPLICATE-ID-01');
    expect(mockRepo.createDonor).not.toHaveBeenCalled();
  });

  it('successfully generates donor code and saves donor', async () => {
    const mockRepo = {
      findByIdProof: jest.fn().mockResolvedValue(null),
      generateNextDonorCode: jest.fn().mockResolvedValue('D-000006'),
      createDonor: jest.fn().mockResolvedValue({
        id: 6,
        donorCode: 'D-000006',
        eligibilityStatus: 'PENDING',
      }),
    };

    const payload = {
      name: 'Ananya Roy',
      age: 24,
      gender: 'FEMALE',
      contact: '9123456789',
      idProof: 'UNIQUE-ID-777',
      medicalHistory: 'None',
    };

    const result = await registerDonor(payload, mockRepo);
    expect(result).toEqual({
      donorId: 'D-000006',
      status: 'PENDING',
    });
    expect(mockRepo.createDonor).toHaveBeenCalled();
  });
});
