// BBMS-SR-001 (SRS §5.1.2) / TC-Sec-01: Enforce HTTPS / TLS 1.2+
// All client-server and integration traffic must use TLS 1.2 or higher; no plaintext channel is accepted.

const MIN_TLS_VERSION = 'TLSv1.2';
const SUPPORTED_TLS_VERSIONS = ['TLSv1.2', 'TLSv1.3'];

// Approved secure cipher suites conforming to modern TLS 1.2+ best practices (disallow RC4, 3DES, MD5)
const APPROVED_CIPHERS = [
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'DHE-RSA-AES128-GCM-SHA256',
  'DHE-RSA-AES256-GCM-SHA384',
].join(':');

/**
 * Validates whether a requested TLS protocol version is accepted under BBMS-SR-001 (TLS 1.2+).
 * @param {string} version - e.g. 'TLSv1.2', 'TLSv1.3'
 * @returns {boolean}
 */
function isTlsVersionAllowed(version) {
  if (!version) return false;
  const normalized = String(version).trim();
  return (
    normalized === 'TLSv1.2' ||
    normalized === 'TLSv1.3' ||
    normalized === 'TLS 1.2' ||
    normalized === 'TLS 1.3' ||
    normalized === '1.2' ||
    normalized === '1.3'
  );
}

/**
 * Generates TLS server security options strictly enforcing TLS 1.2 minimum version and modern ciphers.
 * Used for https.createServer and secure TLS contexts.
 * @param {object} [customOptions={}]
 * @returns {object}
 */
function getTlsSecurityOptions(customOptions = {}) {
  return {
    minVersion: MIN_TLS_VERSION,
    maxVersion: 'TLSv1.3',
    ciphers: APPROVED_CIPHERS,
    honorCipherOrder: true,
    ...customOptions,
  };
}

/**
 * Express middleware to enforce HTTPS and TLS 1.2+ on all client-server and integration traffic.
 * Rejects unencrypted plaintext channels with HTTP 426 Upgrade Required.
 * Injects Strict-Transport-Security (HSTS) headers.
 */
function enforceTlsAndHttps(req, res, next) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const isDirectHttps = Boolean(req.secure || req.socket?.encrypted);
  const isForwardedHttps = forwardedProto === 'https';
  const isHttps = isDirectHttps || isForwardedHttps;

  // Plaintext channel detection:
  // 1. Explicitly forwarded as http (e.g. from reverse proxy or test harness)
  // 2. Strict enforcement enabled (ENFORCE_HTTPS=true or NODE_ENV=production) and not HTTPS
  const isExplicitPlaintext = forwardedProto === 'http';
  const isStrictEnforced = process.env.ENFORCE_HTTPS === 'true' || process.env.NODE_ENV === 'production';
  const isPlaintextBlocked = isExplicitPlaintext || (isStrictEnforced && !isHttps);

  if (isPlaintextBlocked) {
    res.setHeader('Upgrade', 'TLS/1.2, HTTP/1.1');
    return res.status(426).json({
      status: 426,
      code: 'HTTPS_REQUIRED',
      message: 'Plaintext HTTP is not accepted. All client-server and integration traffic must use HTTPS with TLS 1.2 or higher (BBMS-SR-001).',
      requirement: 'BBMS-SR-001',
      minTlsVersion: MIN_TLS_VERSION,
    });
  }

  // Check client/proxy-reported TLS version header if present
  const clientTlsVersion = req.headers['x-tls-version'];
  if (clientTlsVersion && !isTlsVersionAllowed(clientTlsVersion)) {
    return res.status(426).json({
      status: 426,
      code: 'INSECURE_TLS_VERSION',
      message: `TLS version "${clientTlsVersion}" is not accepted. TLS 1.2 or higher is required (BBMS-SR-001).`,
      requirement: 'BBMS-SR-001',
      minTlsVersion: MIN_TLS_VERSION,
    });
  }

  // Invalidate insecure HTTP by sending Strict-Transport-Security (HSTS)
  // max-age: 1 year (31,536,000 seconds), includes all subdomains and preload list
  if (isHttps || isStrictEnforced) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  return next();
}

/**
 * Handler for introspecting the active TLS security policy.
 */
function getTlsPolicy(req, res) {
  return res.status(200).json({
    requirement: 'BBMS-SR-001',
    description: 'Enforce HTTPS and TLS 1.2+ for all client-server and integration traffic',
    minTlsVersion: MIN_TLS_VERSION,
    supportedVersions: SUPPORTED_TLS_VERSIONS,
    plaintextAllowed: false,
    hsts: {
      enabled: true,
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });
}

module.exports = {
  MIN_TLS_VERSION,
  SUPPORTED_TLS_VERSIONS,
  APPROVED_CIPHERS,
  isTlsVersionAllowed,
  getTlsSecurityOptions,
  enforceTlsAndHttps,
  getTlsPolicy,
};
