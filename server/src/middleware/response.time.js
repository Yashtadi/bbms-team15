// BBMS-NF-001 (SRS §5) / TC-Perf-01: search and inventory queries return within 2 seconds.
// Every response gets a Server-Timing header with the time the API spent on it, and any request
// slower than the threshold is logged, so a slow query shows up in the server logs (NF-002 monitoring).

const DEFAULT_SLOW_REQUEST_MS = 2000;

/**
 * Slow-request threshold in milliseconds. SLOW_REQUEST_MS overrides the 2000 ms default;
 * anything that is not a positive whole number falls back to the default.
 * @param {object} [env]
 * @returns {number}
 */
function getSlowRequestThresholdMs(env = process.env) {
  const parsed = Number(env.SLOW_REQUEST_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SLOW_REQUEST_MS;
}

/**
 * A request is slow only when it takes longer than the threshold (exactly 2000 ms still meets NF-001).
 * @param {number} durationMs
 * @param {number} thresholdMs
 * @returns {boolean}
 */
function isSlowRequest(durationMs, thresholdMs = DEFAULT_SLOW_REQUEST_MS) {
  return durationMs > thresholdMs;
}

/**
 * Express middleware factory.
 * @param {object} [options]
 * @param {number} [options.thresholdMs] defaults to SLOW_REQUEST_MS or 2000
 * @param {{ warn: function }} [options.logger]
 * @param {function(): bigint} [options.clock] high-resolution clock in nanoseconds (injectable for tests)
 */
function responseTime({
  thresholdMs = getSlowRequestThresholdMs(),
  logger = console,
  clock = () => process.hrtime.bigint(),
} = {}) {
  return function responseTimeMiddleware(req, res, next) {
    const start = clock();
    const elapsedMs = () => Number(clock() - start) / 1e6;

    // Set the header just before the head is written, when the handler has finished its work
    const originalWriteHead = res.writeHead;
    res.writeHead = function writeHeadWithTiming(...args) {
      if (!res.headersSent) {
        res.setHeader('Server-Timing', `app;dur=${elapsedMs().toFixed(1)}`);
      }
      return originalWriteHead.apply(this, args);
    };

    res.on('finish', () => {
      const durationMs = elapsedMs();
      if (isSlowRequest(durationMs, thresholdMs)) {
        logger.warn(
          `[NF-001] Slow request: ${req.method} ${req.originalUrl} took ${Math.round(durationMs)} ms ` +
            `(status ${res.statusCode}, threshold ${thresholdMs} ms)`
        );
      }
    });

    next();
  };
}

module.exports = {
  DEFAULT_SLOW_REQUEST_MS,
  getSlowRequestThresholdMs,
  isSlowRequest,
  responseTime,
};
