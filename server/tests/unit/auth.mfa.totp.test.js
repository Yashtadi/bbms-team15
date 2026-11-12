const { generateTotp, verifyTotp, getOtpAuthUrl } = require('../../src/modules/auth/mfa.totp');

describe('SR-005 TOTP helpers', () => {
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('matches RFC 6238 SHA-1 test vectors', () => {
    expect(generateTotp(rfcSecret, 59000)).toBe('287082');
    expect(generateTotp(rfcSecret, 1111111109000)).toBe('081804');
    expect(generateTotp(rfcSecret, 2000000000000)).toBe('279037');
  });

  it('verifies a valid code within the adjacent time window and rejects invalid input', () => {
    const now = 1712345678000;
    expect(verifyTotp(rfcSecret, generateTotp(rfcSecret, now), now)).toBe(true);
    expect(verifyTotp(rfcSecret, '12345', now)).toBe(false);
    expect(verifyTotp(rfcSecret, 'abcdef', now)).toBe(false);
  });

  it('creates an authenticator-compatible provisioning URI', () => {
    expect(getOtpAuthUrl(rfcSecret, 'admin@example.test')).toContain('otpauth://totp/');
    expect(getOtpAuthUrl(rfcSecret, 'admin@example.test')).toContain(`secret=${rfcSecret}`);
  });
});
