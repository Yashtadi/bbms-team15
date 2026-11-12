const express = require('express');
const healthService = require('./health.service');

const router = express.Router();

// BBMS-NF-002: health checks are deliberately public (no requireRole), like the original
// GET /api/health, so external uptime monitors and load balancers can call them without a token.
// They return no personal or configuration data. See docs/OPERATIONS.md.

// Health answers must never be cached by a proxy, or an outage could be hidden
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/**
 * Original "is the server alive?" check. Kept unchanged for existing scripts and docs.
 * GET /api/health -> 200 { status: 'ok' }
 */
router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Liveness: the Node process is running.
 * GET /api/health/live -> 200 { status: 'ok', uptimeSeconds, timestamp }
 */
router.get('/live', (req, res) => {
  res.status(200).json(healthService.getLiveness());
});

/**
 * Readiness: the API can serve requests (database reachable, not shutting down).
 * GET /api/health/ready -> 200 { status: 'ok', checks } | 503 { status: 'unavailable', checks }
 */
router.get('/ready', async (req, res) => {
  try {
    const { httpStatus, body } = await healthService.getReadiness();
    return res.status(httpStatus).json(body);
  } catch {
    return res.status(503).json({ status: 'unavailable' });
  }
});

module.exports = router;
