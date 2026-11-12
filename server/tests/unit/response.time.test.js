const request = require('supertest');
const express = require('express');
const {
  DEFAULT_SLOW_REQUEST_MS,
  getSlowRequestThresholdMs,
  isSlowRequest,
  responseTime,
} = require('../../src/middleware/response.time');
const { percentile, measure } = require('../helpers/perf');

// A fake high-resolution clock: each call returns the next reading, in milliseconds
function fakeClock(readingsMs) {
  const readings = readingsMs.map((ms) => BigInt(Math.round(ms * 1e6)));
  let i = 0;
  return () => readings[Math.min(i++, readings.length - 1)];
}

describe('TC-Perf-01: BBMS-NF-001 response-time middleware (unit)', () => {
  describe('isSlowRequest (2000 ms boundary)', () => {
    it.each([
      [1999, false],
      [2000, false],
      [2000.5, true],
      [2001, true],
    ])('%p ms -> slow %p', (ms, slow) => {
      expect(isSlowRequest(ms, 2000)).toBe(slow);
    });
  });

  describe('getSlowRequestThresholdMs', () => {
    it('defaults to 2000 ms', () => {
      expect(getSlowRequestThresholdMs({})).toBe(DEFAULT_SLOW_REQUEST_MS);
      expect(DEFAULT_SLOW_REQUEST_MS).toBe(2000);
    });

    it('uses SLOW_REQUEST_MS when it is a positive whole number', () => {
      expect(getSlowRequestThresholdMs({ SLOW_REQUEST_MS: '500' })).toBe(500);
    });

    it.each(['0', '-1', 'fast', '1.5'])('falls back to 2000 for %p', (value) => {
      expect(getSlowRequestThresholdMs({ SLOW_REQUEST_MS: value })).toBe(2000);
    });
  });

  describe('responseTime middleware', () => {
    function appWith(options) {
      const app = express();
      app.use(responseTime(options));
      app.get('/api/inventory/summary', (req, res) => res.json({ ok: true }));
      app.get('/api/missing', (req, res) => res.status(404).json({ message: 'nope' }));
      return app;
    }

    it('adds a Server-Timing header with the time spent', async () => {
      const logger = { warn: jest.fn() };
      const res = await request(appWith({ logger, clock: fakeClock([0, 12.34, 12.34]) })).get('/api/inventory/summary');

      expect(res.status).toBe(200);
      expect(res.headers['server-timing']).toBe('app;dur=12.3');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs a request that takes longer than the threshold', async () => {
      const logger = { warn: jest.fn() };
      await request(appWith({ logger, thresholdMs: 2000, clock: fakeClock([0, 2500, 2500]) })).get('/api/missing');

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toMatch(/Slow request: GET \/api\/missing took 2500 ms \(status 404, threshold 2000 ms\)/);
    });

    it('does not log a request that takes exactly the threshold', async () => {
      const logger = { warn: jest.fn() };
      await request(appWith({ logger, thresholdMs: 2000, clock: fakeClock([0, 2000, 2000]) })).get('/api/inventory/summary');
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});

describe('TC-Perf-01: percentile and measure helpers (unit)', () => {
  it('computes nearest-rank percentiles', () => {
    const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(oneToHundred, 95)).toBe(95);
    expect(percentile(oneToHundred, 100)).toBe(100);
    expect(percentile(oneToHundred, 50)).toBe(50);
    expect(percentile([30, 10, 20], 95)).toBe(30);
    expect(percentile([7], 95)).toBe(7);
  });

  it('rejects empty input and out-of-range p', () => {
    expect(() => percentile([], 95)).toThrow(/at least one value/);
    expect(() => percentile([1], 0)).toThrow(/p must be/);
    expect(() => percentile([1], 101)).toThrow(/p must be/);
  });

  it('runs exactly `total` calls, never more than `concurrency` at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const send = jest.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { status: 200 };
    });
    const check = jest.fn();

    const timings = await measure(send, { total: 25, concurrency: 4, check });

    expect(send).toHaveBeenCalledTimes(25);
    expect(check).toHaveBeenCalledTimes(25);
    expect(timings).toHaveLength(25);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    timings.forEach((ms) => expect(ms).toBeGreaterThanOrEqual(0));
  });
});
