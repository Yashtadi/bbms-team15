const request = require('supertest');
const https = require('https');
const app = require('../../src/app');
const { createSecureServer } = require('../../src/server');
const { MIN_TLS_VERSION, SUPPORTED_TLS_VERSIONS } = require('../../src/middleware/tls.enforcement');

// TC-Sec-01 / BBMS-SR-001 (SRS §5.1.2): Enforce HTTPS / TLS 1.2+
// Requirement: All client-server and integration traffic uses TLS 1.2 or higher; no plaintext channel is accepted.
describe('TC-Sec-01: BBMS-SR-001 HTTPS & TLS 1.2+ Enforcement (Integration)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects plaintext HTTP traffic across endpoints with HTTP 426 Upgrade Required', async () => {
    const endpoints = ['/api/health', '/api/security/tls-policy', '/api/auth/login'];

    for (const endpoint of endpoints) {
      const res = await request(app)
        .get(endpoint)
        .set('x-forwarded-proto', 'http');

      expect(res.status).toBe(426);
      expect(res.headers['upgrade']).toBe('TLS/1.2, HTTP/1.1');
      expect(res.body.code).toBe('HTTPS_REQUIRED');
      expect(res.body.requirement).toBe('BBMS-SR-001');
      expect(res.body.minTlsVersion).toBe('TLSv1.2');
      expect(res.body.message).toContain('Plaintext HTTP is not accepted');
    }
  });

  it('rejects integration traffic passing obsolete TLS version metadata (< TLS 1.2)', async () => {
    const obsoleteVersions = ['TLSv1.0', 'TLSv1.1', 'SSLv3'];

    for (const version of obsoleteVersions) {
      const res = await request(app)
        .get('/api/health')
        .set('x-forwarded-proto', 'https')
        .set('x-tls-version', version);

      expect(res.status).toBe(426);
      expect(res.body.code).toBe('INSECURE_TLS_VERSION');
      expect(res.body.message).toContain('TLS 1.2 or higher is required');
    }
  });

  it('accepts HTTPS traffic with TLS 1.2+ and attaches HSTS headers', async () => {
    const validVersions = ['TLSv1.2', 'TLSv1.3'];

    for (const version of validVersions) {
      const res = await request(app)
        .get('/api/health')
        .set('x-forwarded-proto', 'https')
        .set('x-tls-version', version);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains; preload');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('exposes GET /api/security/tls-policy describing strict TLS 1.2+ compliance', async () => {
    const res = await request(app)
      .get('/api/security/tls-policy')
      .set('x-forwarded-proto', 'https');

    expect(res.status).toBe(200);
    expect(res.body.requirement).toBe('BBMS-SR-001');
    expect(res.body.minTlsVersion).toBe(MIN_TLS_VERSION);
    expect(res.body.supportedVersions).toEqual(SUPPORTED_TLS_VERSIONS);
    expect(res.body.plaintextAllowed).toBe(false);
    expect(res.body.hsts.enabled).toBe(true);
    expect(res.body.hsts.maxAge).toBe(31536000);
  });

  it('creates an HTTPS server instance strictly enforcing minimum TLS 1.2 protocol', () => {
    const server = createSecureServer(app);
    expect(server).toBeInstanceOf(https.Server);
    expect(server.minVersion).toBe('TLSv1.2');
    expect(server.maxVersion).toBe('TLSv1.3');
  });
});
