const {
  checkEligibility,
  isEligible,
  evaluateDonorEligibility,
} = require('../../src/modules/donor/donor.service');

describe('TC-Reg-02: donor eligibility (unit)', () => {
  const standardEligibleVitals = {
    age: 25,
    weight: 60,
    hemoglobin: 14.0,
    daysSinceLastDonation: 120,
  };

  it('accepts completely eligible donor vitals', () => {
    const result = checkEligibility(standardEligibleVitals);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.reason).toBeNull();
    expect(isEligible(standardEligibleVitals)).toBe(true);
  });

  describe('Age boundary tests (SRS §4.1: 18–65 accepted; 17 and 66 rejected)', () => {
    it('rejects age 17 (boundary, below minimum)', () => {
      const result = checkEligibility({ ...standardEligibleVitals, age: 17 });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Donor age must be between 18 and 65');
      expect(isEligible({ ...standardEligibleVitals, age: 17 })).toBe(false);
    });

    it('accepts age 18 (boundary, minimum)', () => {
      const result = checkEligibility({ ...standardEligibleVitals, age: 18 });
      expect(result.eligible).toBe(true);
      expect(isEligible({ ...standardEligibleVitals, age: 18 })).toBe(true);
    });

    it('accepts age 65 (boundary, maximum)', () => {
      const result = checkEligibility({ ...standardEligibleVitals, age: 65 });
      expect(result.eligible).toBe(true);
      expect(isEligible({ ...standardEligibleVitals, age: 65 })).toBe(true);
    });

    it('rejects age 66 (boundary, above maximum)', () => {
      const result = checkEligibility({ ...standardEligibleVitals, age: 66 });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Donor age must be between 18 and 65');
      expect(isEligible({ ...standardEligibleVitals, age: 66 })).toBe(false);
    });
  });

  describe('Weight boundary tests (SRS §4.1: weight >= 45 kg)', () => {
    it('rejects weight 44.9 kg (boundary, below minimum)', () => {
      const result = checkEligibility({ ...standardEligibleVitals, weight: 44.9 });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Weight must be at least 45 kg');
    });

    it('accepts weight 45.0 kg (boundary, minimum)', () => {
      const result = checkEligibility({ ...standardEligibleVitals, weight: 45.0 });
      expect(result.eligible).toBe(true);
    });
  });

  describe('Haemoglobin boundary tests (SRS §4.1 / NACO: >= 12.5 g/dL)', () => {
    it('rejects haemoglobin 12.4 g/dL (boundary, below minimum)', () => {
      const result = checkEligibility({ ...standardEligibleVitals, hemoglobin: 12.4 });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Haemoglobin must be at least 12.5 g/dL');
    });

    it('accepts haemoglobin 12.5 g/dL (boundary, minimum)', () => {
      const result = checkEligibility({ ...standardEligibleVitals, hemoglobin: 12.5 });
      expect(result.eligible).toBe(true);
    });
  });

  describe('Donation gap boundary tests (SRS §4.1: at least 90 days since last donation)', () => {
    it('rejects donation gap of 89 days (boundary, below minimum interval)', () => {
      const result = checkEligibility({ ...standardEligibleVitals, daysSinceLastDonation: 89 });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('At least 90 days required since last donation');
    });

    it('accepts donation gap of 90 days (boundary, minimum interval)', () => {
      const result = checkEligibility({ ...standardEligibleVitals, daysSinceLastDonation: 90 });
      expect(result.eligible).toBe(true);
    });

    it('accepts a first-time donor with no previous donations', () => {
      const result = checkEligibility({ ...standardEligibleVitals, daysSinceLastDonation: null });
      expect(result.eligible).toBe(true);
    });
  });

  describe('Multiple violations', () => {
    it('blocks with all clear reason messages when multiple rules are broken', () => {
      const result = checkEligibility({
        age: 16,
        weight: 42,
        hemoglobin: 11.0,
        daysSinceLastDonation: 30,
      });

      expect(result.eligible).toBe(false);
      expect(result.reasons).toHaveLength(4);
      expect(result.reason).toContain('Donor age must be between 18 and 65');
      expect(result.reason).toContain('Weight must be at least 45 kg');
      expect(result.reason).toContain('Haemoglobin must be at least 12.5 g/dL');
      expect(result.reason).toContain('At least 90 days required since last donation');
    });
  });
});

describe('TC-Reg-02: evaluateDonorEligibility service logic with database updates', () => {
  it('marks donor as DEFERRED and throws 422 when criteria are not met', async () => {
    const mockRepo = {
      findByIdOrCode: jest.fn().mockResolvedValue({
        id: 1,
        donor_code: 'D-000001',
        date_of_birth: '2000-01-01',
      }),
      findLastDonation: jest.fn().mockResolvedValue({
        collected_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
      }),
      updateEligibility: jest.fn().mockResolvedValue(),
    };

    const vitals = { weight: 55, hemoglobin: 13.5 };

    await expect(evaluateDonorEligibility(1, vitals, mockRepo)).rejects.toMatchObject({
      status: 422,
      eligible: false,
      reason: expect.stringContaining('At least 90 days required since last donation'),
    });

    expect(mockRepo.updateEligibility).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'DEFERRED',
        deferralReason: expect.stringContaining('At least 90 days required'),
      })
    );
  });

  it('marks donor as ELIGIBLE and returns 200 payload when criteria are met', async () => {
    const mockRepo = {
      findByIdOrCode: jest.fn().mockResolvedValue({
        id: 2,
        donor_code: 'D-000002',
        date_of_birth: '1995-05-15',
      }),
      findLastDonation: jest.fn().mockResolvedValue({
        collected_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // 100 days ago
      }),
      updateEligibility: jest.fn().mockResolvedValue(),
    };

    const vitals = { weight: 65, hemoglobin: 14.5 };
    const result = await evaluateDonorEligibility(2, vitals, mockRepo);

    expect(result).toEqual({
      eligible: true,
      status: 'ELIGIBLE',
      message: 'Donor is eligible to donate blood',
    });

    expect(mockRepo.updateEligibility).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        status: 'ELIGIBLE',
        deferralReason: null,
      })
    );
  });

  it('throws 404 if donor is not found', async () => {
    const mockRepo = {
      findByIdOrCode: jest.fn().mockResolvedValue(null),
    };

    await expect(evaluateDonorEligibility(999, { weight: 60, hemoglobin: 13 }, mockRepo))
      .rejects.toMatchObject({ status: 404, message: 'Donor not found' });
  });
});
