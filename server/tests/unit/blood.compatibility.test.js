const {
  isBloodGroupCompatible,
  RED_CELL_COMPATIBILITY,
  PLASMA_COMPATIBILITY,
} = require('../../src/modules/request/blood.compatibility');

describe('TC-Req-02: Clinical Blood Group Compatibility (Unit)', () => {
  describe('Red Cells & Whole Blood (PRBC / WHOLE_BLOOD)', () => {
    it('allows only O-negative PRBC for an unknown patient group', () => {
      expect(isBloodGroupCompatible(null, 'O-', 'PRBC')).toBe(true);
      expect(isBloodGroupCompatible(null, 'A+', 'PRBC')).toBe(false);
      expect(isBloodGroupCompatible(null, 'O-', 'WHOLE_BLOOD')).toBe(false);
    });

    it('O- is universal red cell donor to all ABO/Rh groups', () => {
      const allGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      allGroups.forEach((patientGroup) => {
        expect(isBloodGroupCompatible(patientGroup, 'O-', 'PRBC')).toBe(true);
        expect(isBloodGroupCompatible(patientGroup, 'O-', 'WHOLE_BLOOD')).toBe(true);
      });
    });

    it('AB+ is universal red cell recipient from all ABO/Rh groups', () => {
      const allGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      allGroups.forEach((donorGroup) => {
        expect(isBloodGroupCompatible('AB+', donorGroup, 'PRBC')).toBe(true);
      });
    });

    it('blocks Rh positive units for Rh negative patients', () => {
      expect(isBloodGroupCompatible('A-', 'A+', 'PRBC')).toBe(false);
      expect(isBloodGroupCompatible('B-', 'B+', 'PRBC')).toBe(false);
      expect(isBloodGroupCompatible('O-', 'O+', 'PRBC')).toBe(false);
      expect(isBloodGroupCompatible('AB-', 'AB+', 'PRBC')).toBe(false);
    });

    it('blocks ABO-incompatible units', () => {
      expect(isBloodGroupCompatible('A+', 'B+', 'PRBC')).toBe(false);
      expect(isBloodGroupCompatible('B+', 'A+', 'PRBC')).toBe(false);
      expect(isBloodGroupCompatible('O+', 'A+', 'PRBC')).toBe(false);
      expect(isBloodGroupCompatible('O+', 'B+', 'PRBC')).toBe(false);
    });
  });

  describe('Plasma (FFP)', () => {
    it('AB is universal plasma donor', () => {
      const allGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      allGroups.forEach((patientGroup) => {
        expect(isBloodGroupCompatible(patientGroup, 'AB+', 'FFP')).toBe(true);
        expect(isBloodGroupCompatible(patientGroup, 'AB-', 'FFP')).toBe(true);
      });
    });

    it('O is universal plasma recipient', () => {
      const allGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      allGroups.forEach((donorGroup) => {
        expect(isBloodGroupCompatible('O+', donorGroup, 'FFP')).toBe(true);
        expect(isBloodGroupCompatible('O-', donorGroup, 'FFP')).toBe(true);
      });
    });
  });

  describe('Edge cases and sanitization', () => {
    it('handles lower case and whitespace', () => {
      expect(isBloodGroupCompatible(' a+ ', ' o- ', 'prbc')).toBe(true);
    });

    it('returns false for missing or null parameters', () => {
      expect(isBloodGroupCompatible(null, 'O+')).toBe(false);
      expect(isBloodGroupCompatible('A+', null)).toBe(false);
      expect(isBloodGroupCompatible('', '')).toBe(false);
    });
  });
});
