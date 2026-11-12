const { EventEmitter } = require('events');
const { setupGracefulShutdown, logUnhandledRejections } = require('../../src/lifecycle');
const healthService = require('../../src/modules/health/health.service');

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('TC-Ops-02: BBMS-NF-002 graceful shutdown (unit)', () => {
  let processRef;
  let logger;
  let exit;
  let pool;

  beforeEach(() => {
    processRef = new EventEmitter();
    logger = { log: jest.fn(), error: jest.fn() };
    exit = jest.fn();
    pool = { end: jest.fn().mockResolvedValue() };
  });

  afterEach(() => {
    healthService.resetShutdownState();
    jest.useRealTimers();
  });

  it('on SIGTERM: readiness turns 503, connections drain, the pool closes and the process exits 0', async () => {
    const server = { close: jest.fn((cb) => cb()) };
    setupGracefulShutdown(server, { pool, processRef, exit, logger });

    processRef.emit('SIGTERM');
    await flush();

    expect(healthService.isShuttingDown()).toBe(true);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('handles SIGINT the same way and ignores a second signal', async () => {
    const server = { close: jest.fn((cb) => cb()) };
    setupGracefulShutdown(server, { pool, processRef, exit, logger });

    processRef.emit('SIGINT');
    processRef.emit('SIGTERM');
    await flush();

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('still exits 0 if closing the pool fails, and logs the error', async () => {
    pool.end.mockRejectedValue(new Error('already closed'));
    const server = { close: jest.fn((cb) => cb()) };
    setupGracefulShutdown(server, { pool, processRef, exit, logger });

    processRef.emit('SIGTERM');
    await flush();

    expect(logger.error).toHaveBeenCalledWith(expect.any(String), 'already closed');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('forces exit 1 when open connections do not drain within the timeout', () => {
    jest.useFakeTimers();
    const server = { close: jest.fn() }; // never calls back
    setupGracefulShutdown(server, { pool, processRef, exit, logger, timeoutMs: 10000 });

    processRef.emit('SIGTERM');
    jest.advanceTimersByTime(9999);
    expect(exit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('logs unhandled promise rejections', () => {
    logUnhandledRejections({ processRef, logger });
    processRef.emit('unhandledRejection', new Error('lost promise'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Unhandled promise rejection'), 'lost promise');
  });
});
