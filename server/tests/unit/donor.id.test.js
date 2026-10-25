const {
  formatDonorCode,
  isValidDonorCode,
  parseDonorCode,
  registerDonor,
} = require('../../src/modules/donor/donor.service');

describe('TC-Reg-03: unique donor ID generation (unit)', () => {
  describe('formatDonorCode (Human-readable format e.g. D-000123)', () => {
    it('formats single digit integer with 6-digit zero padding', () => {
      expect(formatDonorCode(1)).toBe('D-000001');
    });

    it('formats 123 as D-000123 (exact example from SRS §4.1 / AC 4)', () => {
      expect(formatDonorCode(123)).toBe('D-000123');
    });

    it('formats boundary 6-digit number 999999', () => {
      expect(formatDonorCode(999999)).toBe('D-999999');
    });

    it('supports numbers exceeding 6 digits without truncation', () => {
      expect(formatDonorCode(1000000)).toBe('D-1000000');
    });

    it('rejects zero or negative numbers', () => {
      expect(() => formatDonorCode(0)).toThrow('must be a positive integer');
      expect(() => formatDonorCode(-5)).toThrow('must be a positive integer');
    });

    it('rejects floating point numbers or invalid types', () => {
      expect(() => formatDonorCode(12.34)).toThrow('must be a positive integer');
      expect(() => formatDonorCode('invalid')).toThrow('must be a positive integer');
    });
  });

  describe('isValidDonorCode', () => {
    it('validates standard generated codes', () => {
      expect(isValidDonorCode('D-000001')).toBe(true);
      expect(isValidDonorCode('D-000123')).toBe(true);
      expect(isValidDonorCode('D-123456')).toBe(true);
    });

    it('rejects invalid or malformed codes', () => {
      expect(isValidDonorCode('000123')).toBe(false);       // missing D- prefix
      expect(isValidDonorCode('U-000123')).toBe(false);       // wrong prefix (blood unit prefix)
      expect(isValidDonorCode('D-123')).toBe(false);          // underpadded (< 6 digits)
      expect(isValidDonorCode('D-ABCDEF')).toBe(false);       // non-numeric
      expect(isValidDonorCode(null)).toBe(false);
      expect(isValidDonorCode('')).toBe(false);
    });
  });

  describe('parseDonorCode', () => {
    it('extracts sequence number from valid code', () => {
      expect(parseDonorCode('D-000123')).toBe(123);
      expect(parseDonorCode('D-000001')).toBe(1);
    });

    it('returns null for invalid codes', () => {
      expect(parseDonorCode('INVALID')).toBeNull();
      expect(parseDonorCode(null)).toBeNull();
    });
  });

  describe('Automatic assignment on registration', () => {
    it('automatically generates and returns human-readable donorId on successful registration', async () => {
      const mockRepo = {
        findByIdProof: jest.fn().mockResolvedValue(null),
        generateNextDonorCode: jest.fn().mockResolvedValue('D-000123'),
        createDonor: jest.fn().mockResolvedValue({ id: 123, donorCode: 'D-000123' }),
      };

      const payload = {
        name: 'Rahul Dravid',
        age: 35,
        gender: 'MALE',
        contact: '9876543210',
        idProof: 'GOVT-ID-123',
      };

      const result = await registerDonor(payload, mockRepo);

      expect(mockRepo.generateNextDonorCode).toHaveBeenCalled();
      expect(result).toHaveProperty('donorId', 'D-000123');
      expect(isValidDonorCode(result.donorId)).toBe(true);
      expect(mockRepo.createDonor).toHaveBeenCalledWith(
        expect.objectContaining({ donorCode: 'D-000123' })
      );
    });
  });
});
