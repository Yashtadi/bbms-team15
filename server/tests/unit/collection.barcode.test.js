const {
  BARCODE_FORMAT,
  normaliseUnitCode,
  buildUnitRecord,
  getUnitByBarcode,
} = require('../../src/modules/collection/collection.service');

const COLLECTED_AT = new Date('2026-10-27T10:00:00Z');
const EXPIRES_AT = new Date('2026-12-01T10:00:00Z');

// A blood_units row as the repository returns it
const QUARANTINE_ROW = {
  id: 7,
  unit_code: 'U-2026-000007',
  donation_id: 4,
  component: 'WHOLE_BLOOD',
  blood_group: null,
  volume_ml: 350,
  collected_at: COLLECTED_AT,
  expires_at: EXPIRES_AT,
  status: 'QUARANTINE',
};

function mockCollectionRepo(row) {
  return { findUnitByCode: jest.fn().mockResolvedValue(row) };
}

describe('TC-Don-03: blood-unit barcode label (unit)', () => {
  describe('buildUnitRecord', () => {
    it('barcode value equals the unit ID (AC 1)', () => {
      const record = buildUnitRecord(QUARANTINE_ROW);

      expect(record.barcode.value).toBe(QUARANTINE_ROW.unit_code);
      expect(record.barcode.value).toBe(record.unitId);
      expect(record.barcode.format).toBe('CODE128');
      expect(BARCODE_FORMAT).toBe('CODE128');
    });

    it('shows blood group PENDING until lab testing, with the collection date (AC 2)', () => {
      expect(buildUnitRecord(QUARANTINE_ROW)).toEqual({
        unitId: 'U-2026-000007',
        barcode: { format: 'CODE128', value: 'U-2026-000007' },
        bloodGroup: 'PENDING',
        component: 'WHOLE_BLOOD',
        volumeMl: 350,
        status: 'QUARANTINE',
        collectedAt: COLLECTED_AT,
        expiresAt: EXPIRES_AT,
        donationId: 4,
      });
    });

    it('shows the tested blood group once it is set (AC 2)', () => {
      const record = buildUnitRecord({ ...QUARANTINE_ROW, blood_group: 'O-', status: 'AVAILABLE' });

      expect(record.bloodGroup).toBe('O-');
    });
  });

  describe('normaliseUnitCode', () => {
    it.each([
      ['U-2026-000007', 'U-2026-000007'],
      ['u-2026-000007', 'U-2026-000007'],
      ['  U-2026-000007\n', 'U-2026-000007'],
      ['U-2026-1000000', 'U-2026-1000000'], // boundary: more than 6 digits (formatUnitCode does not truncate)
    ])('accepts %p as %s', (input, expected) => {
      expect(normaliseUnitCode(input)).toBe(expected);
    });

    it.each([
      '',
      '   ',
      null,
      undefined,
      2026000007,
      'D-000001',
      'U-26-000001',
      'U-2026-00001', // boundary: only 5 digits
      'U-2026-000001X',
      'TMP-0a1b2c3d4e5f',
      "U-2026-000001' OR 1=1",
    ])('rejects %p', (input) => {
      expect(normaliseUnitCode(input)).toBeNull();
    });
  });

  describe('getUnitByBarcode', () => {
    it('returns the matching unit record for a scanned code (AC 4)', async () => {
      const repo = mockCollectionRepo(QUARANTINE_ROW);

      const record = await getUnitByBarcode(' u-2026-000007 ', repo);

      expect(repo.findUnitByCode).toHaveBeenCalledWith('U-2026-000007');
      expect(record.unitId).toBe('U-2026-000007');
      expect(record.barcode.value).toBe('U-2026-000007');
    });

    it('rejects a malformed code with 400 before touching the database', async () => {
      const repo = mockCollectionRepo(QUARANTINE_ROW);

      await expect(getUnitByBarcode('D-000001', repo)).rejects.toMatchObject({
        status: 400,
        message: 'Validation failed',
        errors: { unitId: expect.stringContaining('U-2026-000123') },
      });
      expect(repo.findUnitByCode).not.toHaveBeenCalled();
    });

    it('returns 404 when no unit has that code', async () => {
      const repo = mockCollectionRepo(null);

      await expect(getUnitByBarcode('U-2026-999999', repo)).rejects.toMatchObject({
        status: 404,
        message: 'Blood unit not found',
      });
    });
  });
});
