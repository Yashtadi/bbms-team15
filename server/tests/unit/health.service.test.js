const {
  withTimeout,
  checkDatabase,
  getLiveness,
  getReadiness,
  markShuttingDown,
  resetShutdownState,
  isShuttingDown,
} = require('../../src/modules/health/health.service');

const silent = { error: jest.fn() };
const upPool = () => ({ query: jest.fn().mockResolvedValue([[{ 1: 1 }]]) });
const downPool = () => ({ query: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:3306 user=root')) });
const hangingPool = () => ({ query: jest.fn(() => new Promise(() => {})) });

describe('TC-Ops-01: BBMS-NF-002 health service (unit)', () => {
  afterEach(() => {
    resetShutdownState();
    jest.clearAllMocks();
  });

  describe('withTimeout', () => {
    it('resolves with the value when the promise is fast enough', async () => {
      await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
    });

    it('rejects when the promise takes longer than the timeout', async () => {
      await expect(withTimeout(new Promise(() => {}), 20)).rejects.toThrow(/Timed out after 20 ms/);
    });
  });

  describe('checkDatabase', () => {
    it('reports up with the latency when SELECT 1 answers', async () => {
      const pool = upPool();
      const result = await checkDatabase({ pool, logger: silent });
      expect(pool.query).toHaveBeenCalledWith('SELECT 1');
      expect(result.status).toBe('up');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('reports down, without the error details, when the query fails', async () => {
      const result = await checkDatabase({ pool: downPool(), logger: silent });
      expect(result).toEqual({ status: 'down' });
      expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|root/);
      expect(silent.error).toHaveBeenCalled();
    });

    it('reports down when the database hangs past the timeout', async () => {
      const result = await checkDatabase({ pool: hangingPool(), timeoutMs: 20, logger: silent });
      expect(result).toEqual({ status: 'down' });
    });
  });

  describe('getLiveness', () => {
    it('reports ok with whole seconds of uptime, without touching the database', () => {
      const now = new Date('2026-11-12T10:00:00.000Z');
      expect(getLiveness({ uptime: () => 123.9, now })).toEqual({
        status: 'ok',
        uptimeSeconds: 123,
        timestamp: '2026-11-12T10:00:00.000Z',
      });
    });
  });

  describe('getReadiness', () => {
    it('is 200 ok when the database is up', async () => {
      const { httpStatus, body } = await getReadiness({ pool: upPool(), logger: silent });
      expect(httpStatus).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.checks).toMatchObject({ server: 'up', database: 'up' });
    });

    it('is 503 unavailable when the database is down', async () => {
      const { httpStatus, body } = await getReadiness({ pool: downPool(), logger: silent });
      expect(httpStatus).toBe(503);
      expect(body).toMatchObject({ status: 'unavailable', checks: { server: 'up', database: 'down' } });
    });

    it('is 503 while the server is shutting down, even with the database up', async () => {
      expect(isShuttingDown()).toBe(false);
      markShuttingDown();
      expect(isShuttingDown()).toBe(true);

      const { httpStatus, body } = await getReadiness({ pool: upPool(), logger: silent });
      expect(httpStatus).toBe(503);
      expect(body.checks.server).toBe('shutting_down');
    });
  });
});
