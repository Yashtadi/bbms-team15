const {
  safeRangeFor,
  validateVitals,
  checkVitalsSafety,
  recordVitals,
} = require('../../src/modules/collection/collection.service');

// A reading with every value comfortably inside the safe range
const NORMAL_VITALS = { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, hemoglobinGDl: 13.5 };

function mockCollectionRepo(donation = { id: 21 }) {
  return {
    findById: jest.fn().mockResolvedValue(donation),
    updateVitals: jest.fn().mockResolvedValue(undefined),
  };
}

describe('TC-Don-02: capture pre/post-donation vitals (unit)', () => {
  describe('checkVitalsSafety: range check boundaries (AC 3)', () => {
    it('gives no warnings for a normal reading', () => {
      expect(checkVitalsSafety(NORMAL_VITALS, 'PRE')).toEqual([]);
      expect(checkVitalsSafety(NORMAL_VITALS, 'POST')).toEqual([]);
    });

    it.each([
      ['bpSystolic', 100],
      ['bpSystolic', 140],
      ['bpDiastolic', 60],
      ['bpDiastolic', 90],
      ['pulseBpm', 60],
      ['pulseBpm', 100],
      ['hemoglobinGDl', 12.5],
      ['hemoglobinGDl', 18],
    ])('accepts %s = %p (boundary, just inside the safe range)', (field, value) => {
      expect(checkVitalsSafety({ ...NORMAL_VITALS, [field]: value }, 'PRE')).toEqual([]);
    });

    it.each([
      ['bpSystolic', 99, 'below the safe minimum of 100 mmHg'],
      ['bpSystolic', 141, 'above the safe maximum of 140 mmHg'],
      ['bpDiastolic', 59, 'below the safe minimum of 60 mmHg'],
      ['bpDiastolic', 91, 'above the safe maximum of 90 mmHg'],
      ['pulseBpm', 59, 'below the safe minimum of 60 bpm'],
      ['pulseBpm', 101, 'above the safe maximum of 100 bpm'],
      ['hemoglobinGDl', 12.4, 'below the safe minimum of 12.5 g/dL'],
      ['hemoglobinGDl', 18.1, 'above the safe maximum of 18 g/dL'],
    ])('flags %s = %p (boundary, just outside the safe range)', (field, value, problem) => {
      const warnings = checkVitalsSafety({ ...NORMAL_VITALS, [field]: value }, 'PRE');

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ field, value });
      expect(warnings[0].message).toContain(problem);
      expect(warnings[0].message).toContain('pre-donation');
    });

    it('flags every out-of-range value in one reading', () => {
      const warnings = checkVitalsSafety(
        { bpSystolic: 160, bpDiastolic: 100, pulseBpm: 110, hemoglobinGDl: 11 },
        'PRE'
      );
      expect(warnings.map((w) => w.field)).toEqual(['bpSystolic', 'bpDiastolic', 'pulseBpm', 'hemoglobinGDl']);
    });

    it('does not flag low post-donation haemoglobin (an expected drop)', () => {
      expect(checkVitalsSafety({ ...NORMAL_VITALS, hemoglobinGDl: 12.4 }, 'POST')).toEqual([]);
      expect(checkVitalsSafety({ ...NORMAL_VITALS, hemoglobinGDl: 9 }, 'POST')).toEqual([]);
    });

    it('still flags high post-donation haemoglobin', () => {
      const warnings = checkVitalsSafety({ ...NORMAL_VITALS, hemoglobinGDl: 18.1 }, 'POST');

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ field: 'hemoglobinGDl', value: 18.1, min: null, max: 18 });
      expect(warnings[0].message).toContain('post-donation');
    });

    it.each([
      ['bpSystolic', 99],
      ['bpDiastolic', 91],
      ['pulseBpm', 101],
    ])('uses the same post-donation range as pre-donation for %s = %p', (field, value) => {
      expect(checkVitalsSafety({ ...NORMAL_VITALS, [field]: value }, 'POST')).toHaveLength(1);
    });

    it('safeRangeFor returns the phase-specific haemoglobin range', () => {
      expect(safeRangeFor('hemoglobinGDl', 'PRE')).toEqual({ min: 12.5, max: 18 });
      expect(safeRangeFor('hemoglobinGDl', 'POST')).toEqual({ min: null, max: 18 });
      expect(safeRangeFor('pulseBpm', 'POST')).toEqual({ min: 60, max: 100 });
    });
  });

  describe('validateVitals: invalid input is rejected (AC 4)', () => {
    it('accepts a normal reading', () => {
      expect(validateVitals(NORMAL_VITALS)).toEqual({ isValid: true, errors: {}, vitals: NORMAL_VITALS });
    });

    it('accepts numeric strings and converts them to numbers', () => {
      const result = validateVitals({ bpSystolic: '120', bpDiastolic: '80', pulseBpm: ' 72 ', hemoglobinGDl: '13.5' });
      expect(result.isValid).toBe(true);
      expect(result.vitals).toEqual(NORMAL_VITALS);
    });

    it('accepts out-of-safe-range but possible values (they are flagged, not rejected)', () => {
      expect(validateVitals({ bpSystolic: 180, bpDiastolic: 110, pulseBpm: 130, hemoglobinGDl: 9.5 }).isValid).toBe(true);
    });

    it.each(['bpSystolic', 'bpDiastolic', 'pulseBpm', 'hemoglobinGDl'])('rejects a negative %s', (field) => {
      const result = validateVitals({ ...NORMAL_VITALS, [field]: -5 });
      expect(result.isValid).toBe(false);
      expect(Object.keys(result.errors)).toEqual([field]);
    });

    it.each(['abc', true, {}, [], 'NaN', 'Infinity'])('rejects non-numeric value %p', (value) => {
      const result = validateVitals({ ...NORMAL_VITALS, pulseBpm: value });
      expect(result.isValid).toBe(false);
      expect(result.errors.pulseBpm).toMatch(/must be a number|whole number/);
    });

    it.each([0, '0'])('rejects zero (%p)', (value) => {
      expect(validateVitals({ ...NORMAL_VITALS, bpSystolic: value }).errors.bpSystolic).toMatch(/between 1 and 300/);
    });

    it.each([
      ['bpSystolic', 300, 301],
      ['bpDiastolic', 200, 201],
      ['pulseBpm', 250, 251],
      ['hemoglobinGDl', 25, 25.1],
    ])('accepts %s at its maximum %p and rejects %p (impossible value)', (field, max, overMax) => {
      // Keep diastolic below systolic so only the field under test can fail
      const base = { ...NORMAL_VITALS, bpSystolic: 300 };
      expect(validateVitals({ ...base, [field]: max }).errors[field]).toBeUndefined();
      expect(validateVitals({ ...base, [field]: overMax }).errors[field]).toBeDefined();
    });

    it('accepts haemoglobin 0.1 (minimum) and rejects anything with more than 1 decimal place', () => {
      expect(validateVitals({ ...NORMAL_VITALS, hemoglobinGDl: 0.1 }).isValid).toBe(true);
      expect(validateVitals({ ...NORMAL_VITALS, hemoglobinGDl: 12.34 }).errors.hemoglobinGDl).toMatch(/1 decimal place/);
    });

    it.each(['bpSystolic', 'bpDiastolic', 'pulseBpm'])('rejects a decimal %s', (field) => {
      const result = validateVitals({ ...NORMAL_VITALS, [field]: 72.5 });
      expect(result.errors[field]).toMatch(/whole number/);
    });

    it.each([undefined, null, ''])('requires every reading (got %p)', (value) => {
      const result = validateVitals({ bpSystolic: value, bpDiastolic: value, pulseBpm: value, hemoglobinGDl: value });
      expect(result.errors).toEqual({
        bpSystolic: 'Systolic BP is required',
        bpDiastolic: 'Diastolic BP is required',
        pulseBpm: 'Pulse is required',
        hemoglobinGDl: 'Haemoglobin is required',
      });
    });

    it('treats a missing body as all readings missing', () => {
      expect(Object.keys(validateVitals(undefined).errors)).toHaveLength(4);
    });

    it.each([80, 90])('rejects diastolic %p when systolic is 80 (not lower than systolic)', (diastolic) => {
      const result = validateVitals({ ...NORMAL_VITALS, bpSystolic: 80, bpDiastolic: diastolic });
      expect(result.errors).toEqual({ bpDiastolic: 'Diastolic BP must be lower than systolic BP' });
    });
  });

  describe('recordVitals', () => {
    it('stores pre-donation vitals against the session and returns them (AC 1 & AC 2)', async () => {
      const repo = mockCollectionRepo();

      const result = await recordVitals('21', 'PRE', NORMAL_VITALS, repo);

      expect(repo.findById).toHaveBeenCalledWith(21);
      expect(repo.updateVitals).toHaveBeenCalledWith(21, 'PRE', NORMAL_VITALS);
      expect(result).toEqual({ donationId: 21, phase: 'PRE', vitals: NORMAL_VITALS, warnings: [] });
    });

    it('stores post-donation vitals under the POST phase (AC 1 & AC 2)', async () => {
      const repo = mockCollectionRepo();

      const result = await recordVitals(21, 'POST', NORMAL_VITALS, repo);

      expect(repo.updateVitals).toHaveBeenCalledWith(21, 'POST', NORMAL_VITALS);
      expect(result.phase).toBe('POST');
    });

    it('stores out-of-range readings and returns warnings (AC 3)', async () => {
      const repo = mockCollectionRepo();
      const vitals = { ...NORMAL_VITALS, pulseBpm: 101 };

      const result = await recordVitals(21, 'PRE', vitals, repo);

      expect(repo.updateVitals).toHaveBeenCalledWith(21, 'PRE', vitals);
      expect(result.warnings).toEqual([
        expect.objectContaining({ field: 'pulseBpm', value: 101, min: 60, max: 100 }),
      ]);
    });

    it('rejects invalid readings with 400 before touching the database (AC 4)', async () => {
      const repo = mockCollectionRepo();

      await expect(
        recordVitals(21, 'PRE', { ...NORMAL_VITALS, bpSystolic: -120, hemoglobinGDl: 'abc' }, repo)
      ).rejects.toMatchObject({
        status: 400,
        message: 'Validation failed',
        errors: { bpSystolic: expect.any(String), hemoglobinGDl: expect.any(String) },
      });
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.updateVitals).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown donation', async () => {
      const repo = mockCollectionRepo(null);

      await expect(recordVitals(999999, 'PRE', NORMAL_VITALS, repo)).rejects.toMatchObject({
        status: 404,
        message: 'Donation not found',
      });
      expect(repo.updateVitals).not.toHaveBeenCalled();
    });

    it.each(['abc', '12abc', '0', '-1', '1.5'])('returns 404 for a malformed donation id %p', async (id) => {
      const repo = mockCollectionRepo();

      await expect(recordVitals(id, 'PRE', NORMAL_VITALS, repo)).rejects.toMatchObject({ status: 404 });
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('throws for an unknown phase (programming error)', async () => {
      await expect(recordVitals(21, 'DURING', NORMAL_VITALS, mockCollectionRepo())).rejects.toThrow(
        'Unknown vitals phase'
      );
    });
  });
});
