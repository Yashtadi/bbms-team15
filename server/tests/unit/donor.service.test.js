const {
  validateDonorRegistration,
  registerDonor,
  getDonor,
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

  it('rejects underage donors (<18)', () => {
    const result = validateDonorRegistration({ ...validPayload, age: 17 });
    expect(result.isValid).toBe(false);
    expect(result.errors.age).toBe('Age must be between 18 and 65');
  });

  it('rejects overage donors (>65)', () => {
    const result = validateDonorRegistration({ ...validPayload, age: 66 });
    expect(result.isValid).toBe(false);
    expect(result.errors.age).toBe('Age must be between 18 and 65');
  });

  it('accepts boundary age 18', () => {
    const result = validateDonorRegistration({ ...validPayload, age: 18 });
    expect(result.isValid).toBe(true);
  });

  it('accepts boundary age 65', () => {
    const result = validateDonorRegistration({ ...validPayload, age: 65 });
    expect(result.isValid).toBe(true);
  });

  it('rejects invalid gender value', () => {
    const result = validateDonorRegistration({ ...validPayload, gender: 'UNKNOWN' });
    expect(result.isValid).toBe(false);
    expect(result.errors.gender).toBe('Gender must be MALE, FEMALE, or OTHER');
  });

  it('accumulates multiple validation errors', () => {
    const result = validateDonorRegistration({
      name: '',
      age: 12,
      gender: 'INVALID',
      contact: '',
      idProof: '',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveProperty('name');
    expect(result.errors).toHaveProperty('age');
    expect(result.errors).toHaveProperty('gender');
    expect(result.errors).toHaveProperty('contact');
    expect(result.errors).toHaveProperty('idProof');
  });
});

describe('TC-Reg-04: duplicate donor prevention (unit)', () => {
  it('throws 409 conflict when duplicate ID proof is found', async () => {
    const mockRepo = {
      findByIdProof: jest.fn().mockResolvedValue({ id: 1, id_proof: 'DUP-123' }),
    };

    const payload = {
      name: 'Ramesh Kumar',
      age: 30,
      gender: 'MALE',
      contact: '9999999999',
      idProof: 'DUP-123',
    };

    await expect(registerDonor(payload, mockRepo)).rejects.toMatchObject({
      status: 409,
      message: 'A donor with this ID proof is already registered',
    });
    expect(mockRepo.findByIdProof).toHaveBeenCalledWith('DUP-123');
  });

  it('successfully delegates creation when ID proof is unique', async () => {
    const mockRepo = {
      findByIdProof: jest.fn().mockResolvedValue(null),
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

describe('getDonor (unit)', () => {
  it('retrieves an existing donor by donor code or phone', async () => {
    const mockRepo = {
      findByIdOrCodeOrPhone: jest.fn().mockResolvedValue({
        id: 1,
        donor_code: 'D-000001',
        full_name: 'Ravi Kumar',
        date_of_birth: '1995-04-12',
        gender: 'MALE',
        blood_group: 'O-',
        phone: '9000000001',
        id_proof: 'ID-000001',
        eligibility_status: 'ELIGIBLE',
        consent_given: 1,
      }),
    };

    const donor = await getDonor('D-000001', mockRepo);
    expect(donor.donorCode).toBe('D-000001');
    expect(donor.fullName).toBe('Ravi Kumar');
    expect(donor.eligibilityStatus).toBe('ELIGIBLE');
    expect(donor.consentGiven).toBe(true);
  });

  it('throws 404 when donor does not exist', async () => {
    const mockRepo = {
      findByIdOrCodeOrPhone: jest.fn().mockResolvedValue(null),
    };

    await expect(getDonor('D-999999', mockRepo)).rejects.toMatchObject({
      status: 404,
      message: 'Donor not found',
    });
  });
});
