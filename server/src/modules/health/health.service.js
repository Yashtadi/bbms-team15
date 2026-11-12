// BBMS-NF-002 (SRS §5): 99.5% monthly availability.
// Health checks for uptime monitors and load balancers (see docs/OPERATIONS.md):
//   liveness  - the Node process is up and answering
//   readiness - the API can do real work: the database answers within the timeout, and the
//               server is not shutting down. A 503 tells the load balancer to stop sending traffic.

const defaultPool = require('../../db');

const DEFAULT_DB_TIMEOUT_MS = 2000;

let shuttingDown = false;

/** Called on SIGTERM/SIGINT so readiness turns 503 while open requests drain. */
function markShuttingDown() {
  shuttingDown = true;
}

/** Test helper: back to the normal (not shutting down) state. */
function resetShutdownState() {
  shuttingDown = false;
}

function isShuttingDown() {
  return shuttingDown;
}

/**
 * Resolves with the promise's value, or rejects if it takes longer than timeoutMs.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs SELECT 1 on the pool. A failure or a reply slower than timeoutMs counts as down.
 * Error details are never returned (they could reveal hosts or credentials to an unauthenticated caller).
 * @param {{ pool?: { query: function }, timeoutMs?: number, logger?: { error: function } }} [options]
 * @returns {Promise<{ status: 'up'|'down', latencyMs?: number }>}
 */
async function checkDatabase({ pool = defaultPool, timeoutMs = DEFAULT_DB_TIMEOUT_MS, logger = console } = {}) {
  const started = Date.now();
  try {
    await withTimeout(pool.query('SELECT 1'), timeoutMs);
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (error) {
    logger.error('[NF-002] Readiness check: database unavailable:', error.message);
    return { status: 'down' };
  }
}

/**
 * Liveness: the process is running. Never touches the database, so a database outage does not
 * make a process manager restart a healthy Node process.
 * @returns {{ status: 'ok', uptimeSeconds: number, timestamp: string }}
 */
function getLiveness({ uptime = () => process.uptime(), now = new Date() } = {}) {
  return { status: 'ok', uptimeSeconds: Math.floor(uptime()), timestamp: now.toISOString() };
}

/**
 * Readiness: 200 when the database answers and the server is not shutting down, 503 otherwise.
 * @returns {Promise<{ httpStatus: 200|503, body: object }>}
 */
async function getReadiness({ pool, timeoutMs, logger, now = new Date() } = {}) {
  const database = await checkDatabase({ pool, timeoutMs, logger });
  const server = shuttingDown ? 'shutting_down' : 'up';
  const ready = database.status === 'up' && server === 'up';

  return {
    httpStatus: ready ? 200 : 503,
    body: {
      status: ready ? 'ok' : 'unavailable',
      checks: {
        server,
        database: database.status,
        ...(database.latencyMs !== undefined ? { databaseLatencyMs: database.latencyMs } : {}),
      },
      timestamp: now.toISOString(),
    },
  };
}

module.exports = {
  DEFAULT_DB_TIMEOUT_MS,
  withTimeout,
  checkDatabase,
  getLiveness,
  getReadiness,
  markShuttingDown,
  resetShutdownState,
  isShuttingDown,
};
