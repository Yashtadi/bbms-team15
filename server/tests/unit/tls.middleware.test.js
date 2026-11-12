const {
  MIN_TLS_VERSION,
  SUPPORTED_TLS_VERSIONS,
  isTlsVersionAllowed,
  getTlsSecurityOptions,
  enforceTlsAndHttps,
  getTlsPolicy,
} = require('../../src/middleware/tls.enforcement');

describe('TC-Sec-01: BBMS-SR-001 TLS & HTTPS Enforcement Middleware (Unit)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isTlsVersionAllowed', () => {
    it('accepts TLS 1.2 and TLS 1.3 variants', () => {
      expect(isTlsVersionAllowed('TLSv1.2')).toBe(true);
      expect(isTlsVersionAllowed('TLSv1.3')).toBe(true);
      expect(isTlsVersionAllowed('TLS 1.2')).toBe(true);
      expect(isTlsVersionAllowed('TLS 1.3')).toBe(true);
      expect(isTlsVersionAllowed('1.2')).toBe(true);
      expect(isTlsVersionAllowed('1.3')).toBe(true);
    });

    it('rejects obsolete and insecure protocol versions (TLS 1.0, 1.1, SSLv3, SSLv2)', () => {
      expect(isTlsVersionAllowed('TLSv1.1')).toBe(false);
      expect(isTlsVersionAllowed('TLSv1.0')).toBe(false);
      expect(isTlsVersionAllowed('TLS 1.0')).toBe(false);
      expect(isTlsVersionAllowed('TLS 1.1')).toBe(false);
      expect(isTlsVersionAllowed('SSLv3')).toBe(false);
      expect(isTlsVersionAllowed('SSLv2')).toBe(false);
      expect(isTlsVersionAllowed('')).toBe(false);
      expect(isTlsVersionAllowed(null)).toBe(false);
      expect(isTlsVersionAllowed(undefined)).toBe(false);
    });
  });

  describe('getTlsSecurityOptions', () => {
    it('enforces minVersion TLSv1.2, maxVersion TLSv1.3 and modern cipher suites', () => {
      const options = getTlsSecurityOptions();
      expect(options.minVersion).toBe('TLSv1.2');
      expect(options.maxVersion).toBe('TLSv1.3');
      expect(options.honorCipherOrder).toBe(true);
      expect(options.ciphers).toContain('ECDHE-RSA-AES128-GCM-SHA256');
      expect(options.ciphers).not.toContain('RC4');
      expect(options.ciphers).not.toContain('3DES');
      expect(options.ciphers).not.toContain('MD5');
    });

    it('merges custom options while preserving minimum security defaults', () => {
      const options = getTlsSecurityOptions({ customCert: 'cert-data' });
      expect(options.minVersion).toBe('TLSv1.2');
      expect(options.customCert).toBe('cert-data');
    });
  });

  describe('enforceTlsAndHttps middleware', () => {
    function createMockRes() {
      const headers = {};
      const res = {
        statusCode: 200,
        headers,
        setHeader(key, val) {
          headers[key] = val;
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          return this;
        },
      };
      return res;
    }

    it('blocks explicit plaintext HTTP channel with HTTP 426 Upgrade Required', () => {
      const req = {
        headers: { 'x-forwarded-proto': 'http' },
        secure: false,
      };
      const res = createMockRes();
      const next = jest.fn();

      enforceTlsAndHttps(req, res, next);

      expect(res.statusCode).toBe(426);
      expect(res.headers['Upgrade']).toBe('TLS/1.2, HTTP/1.1');
      expect(res.body.code).toBe('HTTPS_REQUIRED');
      expect(res.body.requirement).toBe('BBMS-SR-001');
      expect(res.body.minTlsVersion).toBe('TLSv1.2');
      expect(next).not.toHaveBeenCalled();
    });

    it('blocks unencrypted requests when ENFORCE_HTTPS=true is set', () => {
      process.env.ENFORCE_HTTPS = 'true';
      const req = {
        headers: {},
        secure: false,
      };
      const res = createMockRes();
      const next = jest.fn();

      enforceTlsAndHttps(req, res, next);

      expect(res.statusCode).toBe(426);
      expect(res.body.code).toBe('HTTPS_REQUIRED');
      expect(next).not.toHaveBeenCalled();
    });

    it('blocks requests passing insecure x-tls-version (e.g. TLSv1.0 or TLSv1.1)', () => {
      const req = {
        headers: {
          'x-forwarded-proto': 'https',
          'x-tls-version': 'TLSv1.1',
        },
        secure: true,
      };
      const res = createMockRes();
      const next = jest.fn();

      enforceTlsAndHttps(req, res, next);

      expect(res.statusCode).toBe(426);
      expect(res.body.code).toBe('INSECURE_TLS_VERSION');
      expect(res.body.message).toContain('TLS 1.2 or higher is required');
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts HTTPS requests, sets HSTS header, and calls next()', () => {
      const req = {
        headers: {
          'x-forwarded-proto': 'https',
          'x-tls-version': 'TLSv1.2',
        },
        secure: true,
      };
      const res = createMockRes();
      const next = jest.fn();

      enforceTlsAndHttps(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains; preload');
      expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    });
  });

  describe('getTlsPolicy handler', () => {
    it('returns standard TLS policy and HSTS configuration', () => {
      const req = {};
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          return this;
        },
      };

      getTlsPolicy(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.requirement).toBe('BBMS-SR-001');
      expect(res.body.minTlsVersion).toBe('TLSv1.2');
      expect(res.body.supportedVersions).toContain('TLSv1.2');
      expect(res.body.plaintextAllowed).toBe(false);
      expect(res.body.hsts.enabled).toBe(true);
      expect(res.body.hsts.maxAge).toBe(31536000);
    });
  });
});
