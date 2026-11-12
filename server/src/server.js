require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const app = require('./app');
const { getTlsSecurityOptions, MIN_TLS_VERSION } = require('./middleware/tls.enforcement');

const PORT = process.env.PORT || 4000;
const HTTPS_PORT = process.env.HTTPS_PORT || 4443;

/**
 * Creates an HTTPS server strictly configured with TLS 1.2+ minimum protocol version.
 * @param {Express.Application} expressApp
 * @param {object} tlsOptions - Must contain `key` and `cert` buffers/strings.
 * @returns {https.Server}
 */
function createSecureServer(expressApp = app, tlsOptions = {}) {
  const secureOptions = getTlsSecurityOptions(tlsOptions);
  return https.createServer(secureOptions, expressApp);
}

function startServer() {
  const hasSslFiles =
    Boolean(process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) &&
    fs.existsSync(process.env.SSL_KEY_PATH) &&
    fs.existsSync(process.env.SSL_CERT_PATH);

  if (hasSslFiles || process.env.USE_HTTPS === 'true') {
    const key = process.env.SSL_KEY || (hasSslFiles ? fs.readFileSync(process.env.SSL_KEY_PATH) : null);
    const cert = process.env.SSL_CERT || (hasSslFiles ? fs.readFileSync(process.env.SSL_CERT_PATH) : null);

    if (key && cert) {
      const server = createSecureServer(app, { key, cert });
      server.listen(HTTPS_PORT, () => {
        console.log(`BBMS Secure API running on https://localhost:${HTTPS_PORT} (minVersion: ${MIN_TLS_VERSION})`);
      });
      return server;
    }
  }

  const server = app.listen(PORT, () => {
    console.log(`BBMS API running on http://localhost:${PORT} (TLS enforcement active)`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  createSecureServer,
  startServer,
};
