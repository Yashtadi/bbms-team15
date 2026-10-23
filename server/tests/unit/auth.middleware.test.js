const { requireRole } = require('../../src/middleware/auth');

describe('requireRole', () => {
  it('accepts a valid role', () => {
    expect(() => requireRole('LAB_TECH')).not.toThrow();
  });

  it('rejects a misspelled role', () => {
    expect(() => requireRole('LABTECH')).toThrow('Unknown role');
  });
});