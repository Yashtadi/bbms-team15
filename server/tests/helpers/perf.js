// TC-Perf-01 helpers: measure request latency and compute percentiles.
//   const { measure, percentile } = require('../helpers/perf');
//   const timings = await measure(() => agent.get('/api/inventory/summary'), { total: 200, concurrency: 10 });
//   expect(percentile(timings, 95)).toBeLessThan(2000);

const { performance } = require('perf_hooks');

/**
 * Nearest-rank percentile: the smallest value that at least p% of the values are at or below.
 * percentile([1..100], 95) === 95.
 * @param {number[]} values
 * @param {number} p between 0 (exclusive) and 100 (inclusive)
 * @returns {number}
 */
function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('percentile needs at least one value');
  }
  if (!(p > 0 && p <= 100)) {
    throw new Error('p must be greater than 0 and at most 100');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1];
}

/**
 * Runs send() `total` times with at most `concurrency` calls in flight, and returns each call's
 * duration in milliseconds. check(response) runs on every response (e.g. to assert status 200).
 * @param {function(): Promise<any>} send
 * @param {{ total: number, concurrency: number, check?: function(any): void }} options
 * @returns {Promise<number[]>}
 */
async function measure(send, { total, concurrency, check = () => {} }) {
  const timings = [];
  let started = 0;

  async function worker() {
    while (started < total) {
      started += 1;
      const begin = performance.now();
      const response = await send();
      timings.push(performance.now() - begin);
      check(response);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  return timings;
}

module.exports = { percentile, measure };
