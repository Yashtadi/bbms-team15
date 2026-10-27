const {
  formatUnitCode,
  normaliseDonationType,
  validateSessionInput,
  buildUnitForSession,
  startDonation,
} = require('../../src/modules/collection/collection.service');

const DAY_MS = 24 * 60 * 60 * 1000;

const ELIGIBLE_DONOR = {
  id: 7,
  donor_code: 'D-000007',
  consent_given: 1,
  eligibility_status: 'ELIGIBLE',
};

function mockDonorRepo(donor) {
  return { findByIdOrCode: jest.fn().mockResolvedValue(donor) };
}

// Behaves like the real repository: asks the service to build the code for a new unit id.
function mockCollectionRepo(unitDbId = 8, donationId = 21) {
  return {
    createSession: jest.fn().mockImplementation(async (data) => ({
      donationId,
      unit: { id: unitDbId, unitCode: data.buildUnitCode(unitDbId) },
    })),
  };
}

describe('TC-Don-01: record donation session (unit)', () => {
  describe('formatUnitCode', () => {
    it('formats a unit code like the seed data (U-YYYY-NNNNNN)', () => {
      expect(formatUnitCode(2026, 1)).toBe('U-2026-000001');
      expect(formatUnitCode(2026, 123)).toBe('U-2026-000123');
    });

    it('does not truncate numbers longer than 6 digits (boundary)', () => {
      expect(formatUnitCode(2026, 999999)).toBe('U-2026-999999');
      expect(formatUnitCode(2026, 1000000)).toBe('U-2026-1000000');
    });

    it.each([0, -1, 1.5, 'abc'])('rejects invalid sequence number %p', (seq) => {
      expect(() => formatUnitCode(2026, seq)).toThrow('positive integer');
    });
  });

  describe('normaliseDonationType', () => {
    it('defaults to WHOLE_BLOOD when not given', () => {
      expect(normaliseDonationType(undefined)).toBe('WHOLE_BLOOD');
      expect(normaliseDonationType(null)).toBe('WHOLE_BLOOD');
      expect(normaliseDonationType('')).toBe('WHOLE_BLOOD');
    });

    it.each([
      ['WHOLE_BLOOD', 'WHOLE_BLOOD'],
      ['whole blood', 'WHOLE_BLOOD'],
      ['Whole-Blood', 'WHOLE_BLOOD'],
      ['APHERESIS', 'APHERESIS'],
      [' apheresis ', 'APHERESIS'],
    ])('accepts %p as %s', (input, expected) => {
      expect(normaliseDonationType(input)).toBe(expected);
    });

    it.each(['PLASMA', 'blood', 42, true])('returns null for unknown type %p', (input) => {
      expect(normaliseDonationType(input)).toBeNull();
    });
  });

  describe('validateSessionInput', () => {
    it.each([1, 450, 1000, '350'])('accepts volume %p mL', (volumeMl) => {
      const result = validateSessionInput({ volumeMl });
      expect(result.isValid).toBe(true);
      expect(result.volumeMl).toBe(Number(volumeMl));
    });

    it.each([0, -50, 1001, 450.5, 'abc', true])('rejects volume %p mL (boundary / invalid)', (volumeMl) => {
      const result = validateSessionInput({ volumeMl });
      expect(result.isValid).toBe(false);
      expect(result.errors.volumeMl).toMatch(/between 1 and 1000/);
    });

    it.each([undefined, null, ''])('requires volume (got %p)', (volumeMl) => {
      const result = validateSessionInput({ volumeMl });
      expect(result.isValid).toBe(false);
      expect(result.errors.volumeMl).toBe('Volume (mL) is required');
    });

    it('rejects an unknown donation type', () => {
      const result = validateSessionInput({ volumeMl: 450, donationType: 'PLASMA' });
      expect(result.isValid).toBe(false);
      expect(result.errors.donationType).toContain('WHOLE_BLOOD, APHERESIS');
    });
  });

  describe('buildUnitForSession', () => {
    const collectedAt = new Date('2026-10-27T10:00:00Z');

    it('whole blood creates a WHOLE_BLOOD unit that expires after 35 days', () => {
      const unit = buildUnitForSession('WHOLE_BLOOD', 450, collectedAt);
      expect(unit).toEqual({
        component: 'WHOLE_BLOOD',
        volumeMl: 450,
        expiresAt: new Date(collectedAt.getTime() + 35 * DAY_MS),
      });
    });

    it('apheresis creates a PLATELETS unit that expires after 5 days', () => {
      const unit = buildUnitForSession('APHERESIS', 250, collectedAt);
      expect(unit).toEqual({
        component: 'PLATELETS',
        volumeMl: 250,
        expiresAt: new Date(collectedAt.getTime() + 5 * DAY_MS),
      });
    });
  });

  describe('startDonation', () => {
    it('records donor, staff, donation type, date and time (AC 1)', async () => {
      const donorRepo = mockDonorRepo(ELIGIBLE_DONOR);
      const collectionRepo = mockCollectionRepo();
      const before = Date.now();

      const result = await startDonation(
        { donorId: 'D-000007', staffId: 3, donationType: 'APHERESIS', volumeMl: 250 },
        donorRepo,
        collectionRepo
      );

      const saved = collectionRepo.createSession.mock.calls[0][0];
      expect(saved).toMatchObject({
        donorId: 7,
        collectedBy: 3,
        donationType: 'APHERESIS',
        volumeMl: 250,
      });
      expect(saved.collectedAt).toBeInstanceOf(Date);
      expect(saved.collectedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(saved.collectedAt.getTime()).toBeLessThanOrEqual(Date.now());

      expect(result).toMatchObject({
        donationId: 21,
        donorId: 'D-000007',
        staffId: 3,
        donationType: 'APHERESIS',
        status: 'IN_PROGRESS',
        collectedAt: saved.collectedAt,
      });
    });

    it('creates a blood unit with a unit ID and status QUARANTINE (AC 3)', async () => {
      const collectionRepo = mockCollectionRepo(8);

      const result = await startDonation(
        { donorId: 'D-000007', staffId: 3, volumeMl: 450 },
        mockDonorRepo(ELIGIBLE_DONOR),
        collectionRepo
      );

      const saved = collectionRepo.createSession.mock.calls[0][0];
      expect(saved.unit).toMatchObject({ component: 'WHOLE_BLOOD', volumeMl: 450 });

      const year = saved.collectedAt.getFullYear();
      expect(result.unit).toEqual({
        unitId: `U-${year}-000008`,
        status: 'QUARANTINE',
        component: 'WHOLE_BLOOD',
        volumeMl: 450,
        expiresAt: new Date(saved.collectedAt.getTime() + 35 * DAY_MS),
      });
    });

    it('defaults donation type to WHOLE_BLOOD', async () => {
      const collectionRepo = mockCollectionRepo();
      const result = await startDonation(
        { donorId: 'D-000007', staffId: 3, volumeMl: 450 },
        mockDonorRepo(ELIGIBLE_DONOR),
        collectionRepo
      );
      expect(result.donationType).toBe('WHOLE_BLOOD');
    });

    it.each([
      ['PENDING', null],
      ['DEFERRED', 'Weight must be at least 45 kg (donor weighs 40 kg)'],
    ])('rejects a consented but %s donor with 422 DONOR_NOT_ELIGIBLE (AC 2)', async (status, reason) => {
      const collectionRepo = mockCollectionRepo();
      const donor = { ...ELIGIBLE_DONOR, eligibility_status: status, deferral_reason: reason };

      const promise = startDonation(
        { donorId: 'D-000007', staffId: 3, volumeMl: 450 },
        mockDonorRepo(donor),
        collectionRepo
      );

      await expect(promise).rejects.toMatchObject({
        status: 422,
        code: 'DONOR_NOT_ELIGIBLE',
        message: expect.stringContaining(`status ${status}`),
      });
      if (reason) {
        await expect(promise).rejects.toMatchObject({ message: expect.stringContaining(reason) });
      }
      expect(collectionRepo.createSession).not.toHaveBeenCalled();
    });

    it('rejects an eligible donor without consent with 422 CONSENT_REQUIRED (AC 2)', async () => {
      const collectionRepo = mockCollectionRepo();
      const donor = { ...ELIGIBLE_DONOR, consent_given: 0 };

      await expect(
        startDonation({ donorId: 'D-000007', staffId: 3, volumeMl: 450 }, mockDonorRepo(donor), collectionRepo)
      ).rejects.toMatchObject({ status: 422, code: 'CONSENT_REQUIRED' });
      expect(collectionRepo.createSession).not.toHaveBeenCalled();
    });

    it('checks consent before eligibility when both are missing', async () => {
      const donor = { ...ELIGIBLE_DONOR, consent_given: 0, eligibility_status: 'PENDING' };

      await expect(
        startDonation({ donorId: 'D-000007', staffId: 3, volumeMl: 450 }, mockDonorRepo(donor), mockCollectionRepo())
      ).rejects.toMatchObject({ status: 422, code: 'CONSENT_REQUIRED' });
    });

    it('rejects invalid input with 400 before touching the database', async () => {
      const donorRepo = mockDonorRepo(ELIGIBLE_DONOR);

      await expect(
        startDonation({ donorId: 'D-000007', staffId: 3, volumeMl: 0, donationType: 'PLASMA' }, donorRepo)
      ).rejects.toMatchObject({
        status: 400,
        message: 'Validation failed',
        errors: {
          volumeMl: expect.any(String),
          donationType: expect.any(String),
        },
      });
      expect(donorRepo.findByIdOrCode).not.toHaveBeenCalled();
    });

    it('requires the staff ID with 400', async () => {
      await expect(
        startDonation({ donorId: 'D-000007', volumeMl: 450 }, mockDonorRepo(ELIGIBLE_DONOR))
      ).rejects.toMatchObject({ status: 400, message: 'staffId is required to start a donation' });
    });
  });
});
