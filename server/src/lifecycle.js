// BBMS-NF-002: process lifecycle for availability.
// On SIGTERM/SIGINT (a deploy, a restart by the process manager or container runtime) the server
// stops taking new connections, lets open requests finish, closes the database pool and exits.
// Readiness reports 503 meanwhile so the load balancer moves traffic away first.

const healthService = require('./modules/health/health.service');

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10000;

/**
 * @param {import('http').Server} server
 * @param {object} [options]
 * @param {{ end: function(): Promise<void> }} [options.pool]
 * @param {number} [options.timeoutMs] force exit if draining takes longer
 * @param {NodeJS.EventEmitter} [options.processRef]
 * @param {function(number): void} [options.exit]
 * @param {{ log: function, error: function }} [options.logger]
 * @returns {function(string): void} the shutdown handler (also bound to SIGTERM and SIGINT)
 */
function setupGracefulShutdown(server, {
  pool = require('./db'),
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  processRef = process,
  exit = (code) => process.exit(code),
  logger = console,
} = {}) {
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    healthService.markShuttingDown();
    logger.log(`[NF-002] ${signal} received: draining connections`);

    const forceExit = setTimeout(() => {
      logger.error(`[NF-002] Shutdown took longer than ${timeoutMs} ms; exiting`);
      exit(1);
    }, timeoutMs);
    if (typeof forceExit.unref === 'function') forceExit.unref();

    server.close(async () => {
      try {
        await pool.end();
      } catch (error) {
        logger.error('[NF-002] Error closing database pool:', error.message);
      }
      clearTimeout(forceExit);
      logger.log('[NF-002] Shutdown complete');
      exit(0);
    });
  };

  processRef.on('SIGTERM', () => shutdown('SIGTERM'));
  processRef.on('SIGINT', () => shutdown('SIGINT'));
  return shutdown;
}

/**
 * Logs a promise rejection nobody handled instead of letting it go unnoticed. Express 5 already
 * passes rejected route handlers to its error handler; this catches anything outside a request.
 */
function logUnhandledRejections({ processRef = process, logger = console } = {}) {
  processRef.on('unhandledRejection', (reason) => {
    logger.error('[NF-002] Unhandled promise rejection:', reason instanceof Error ? reason.message : reason);
  });
}

module.exports = {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  setupGracefulShutdown,
  logUnhandledRejections,
};
