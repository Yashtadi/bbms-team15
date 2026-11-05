const {
  validateDonorRegistration,
  registerDonor,
  getDonor,
  getDonorPortalData,
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

  it('rejects invalid email if provided', () => {
    const result = validateDonorRegistration({ ...validPayload, email: 'not-an-email' });
    expect(result.isValid).toBe(false);
    expect(result.errors.email).toBe('Invalid email address');
  });

  it('accepts valid email if provided', () => {
    const result = validateDonorRegistration({ ...validPayload, email: 'suresh@example.com' });
    expect(result.isValid).toBe(true);
  });
});

describe('TC-Reg-01: registerDonor duplicate checking & assignment (unit)', () => {
  it('rejects registration when duplicate idProof exists (409)', async () => {
    const mockRepo = {
      findByIdProof: jest.fn().mockResolvedValue({ id: 1, donor_code: 'D-000001' }),
    };

    const payload = {
      name: 'Ravi Kumar Duplicate',
      age: 30,
      gender: 'MALE',
      contact: '9999999999',
      idProof: 'EXISTING-ID',
      medicalHistory: 'None',
    };

    await expect(registerDonor(payload, mockRepo)).rejects.toMatchObject({
      status: 409,
      message: 'A donor with this ID proof is already registered',
    });
  });

  it('successfully creates donor and returns assigned Donor ID', async () => {
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

describe('getDonorPortalData (unit)', () => {
  const fakeDonor = {
    id: 1,
    donor_code: 'D-000001',
    user_id: 6,
    full_name: 'Ravi Kumar',
    date_of_birth: '1995-04-12',
    gender: 'MALE',
    blood_group: 'O-',
    phone: '9000000001',
    email: 'donor@bbms.test',
    id_proof: 'ID-000001',
    eligibility_status: 'ELIGIBLE',
    created_at: new Date('2026-01-01'),
  };

  it('computes metrics, 90-day countdown, and returns history', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const mockRepo = {
      findByUserId: jest.fn().mockResolvedValue(fakeDonor),
      findDonationsByDonorId: jest.fn().mockResolvedValue([
        {
          id: 1,
          donor_id: 1,
          collected_at: tenDaysAgo,
          status: 'COMPLETED',
          volume_ml: 450,
          weight_kg: 70,
          hemoglobin_g_dl: 14,
          bp_systolic: 120,
          bp_diastolic: 80,
          pulse_bpm: 72,
          temperature_c: 36.8,
        },
      ]),
    };

    const data = await getDonorPortalData(6, null, mockRepo);

    expect(data.donor.donorCode).toBe('D-000001');
    expect(data.donor.maskedIdProof).toBe('ID-****01');
    expect(data.stats.totalDonations).toBe(1);
    expect(data.stats.totalVolumeMl).toBe(450);
    expect(data.stats.livesSaved).toBe(3);
    expect(data.stats.isEligibleNow).toBe(false);
    expect(data.stats.daysUntilEligible).toBe(80);
    expect(data.history.length).toBe(1);
    expect(data.history[0].volumeMl).toBe(450);
  });

  it('identifies donor as eligible when >= 90 days have elapsed', async () => {
    const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const mockRepo = {
      findByUserId: jest.fn().mockResolvedValue(fakeDonor),
      findDonationsByDonorId: jest.fn().mockResolvedValue([
        {
          id: 1,
          donor_id: 1,
          collected_at: hundredDaysAgo,
          status: 'COMPLETED',
          volume_ml: 450,
        },
      ]),
    };

    const data = await getDonorPortalData(6, null, mockRepo);

    expect(data.stats.isEligibleNow).toBe(true);
    expect(data.stats.daysUntilEligible).toBe(0);
  });

  it('throws 404 if donor is not found', async () => {
    const mockRepo = {
      findByUserId: jest.fn().mockResolvedValue(null),
    };

    await expect(getDonorPortalData(999, null, mockRepo)).rejects.toMatchObject({
      status: 404,
      message: 'Donor profile not found for this account',
    });
  });
});
