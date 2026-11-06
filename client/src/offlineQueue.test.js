import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SYNC_CHUNK_SIZE,
  queueKey,
  loadQueue,
  enqueue,
  removeRecord,
  clearSynced,
  makeClientRef,
  tempRef,
  pendingRecords,
  rejectedRecords,
  syncQueue,
} from './offlineQueue';
import { saveSession, clearSession } from './api';

const USER = 7;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function payload(n = 1) {
  return {
    donorId: `D-${String(n).padStart(6, '0')}`,
    campLocation: 'Camp A',
    collectedAt: '2026-11-06T08:00:00.000Z',
    donationType: 'WHOLE_BLOOD',
    volumeMl: 450,
    vitals: { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, hemoglobinGDl: 13.5 },
  };
}

function fill(count) {
  for (let i = 1; i <= count; i += 1) enqueue(USER, payload(i));
}

function okResponse(results) {
  return { status: 200, json: async () => ({ results }) };
}

// Server stand-in: answers every record in the request with the same status
function answerAll(status, extra = {}) {
  return vi.fn(async (path, options) => {
    const { records } = JSON.parse(options.body);
    return okResponse(records.map((r, i) => ({
      clientRef: r.clientRef,
      status,
      unit: status < 300 ? { unitId: `U-2026-${String(i + 1).padStart(6, '0')}` } : undefined,
      ...extra,
    })));
  });
}

describe('TC-Don-04: offline camp queue (client unit)', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  describe('storage', () => {
    it('enqueues a record as PENDING with a UUID clientRef copied into the payload', () => {
      const { ok, record } = enqueue(USER, payload());

      expect(ok).toBe(true);
      expect(record.clientRef).toMatch(UUID_PATTERN);
      expect(record.payload.clientRef).toBe(record.clientRef);
      expect(record.state).toBe('PENDING');
      expect(pendingRecords(loadQueue(USER))).toHaveLength(1);
    });

    it('keeps one queue per user', () => {
      enqueue(USER, payload());
      expect(loadQueue(8).records).toHaveLength(0);
      expect(localStorage.getItem(queueKey(USER))).not.toBeNull();
    });

    it('returns an empty queue for corrupt storage instead of crashing', () => {
      localStorage.setItem(queueKey(USER), '{not json');
      expect(loadQueue(USER)).toEqual({ records: [], synced: [] });
    });

    it('reports failure when the browser refuses to save (storage full or blocked)', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(enqueue(USER, payload()).ok).toBe(false);
    });

    it('returns an empty queue when storage cannot be read at all', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(loadQueue(USER)).toEqual({ records: [], synced: [] });
    });

    it('survives logout: clearSession does not touch the camp queue', () => {
      saveSession({ token: 't', user: { id: USER } });
      enqueue(USER, payload());

      clearSession();

      expect(loadQueue(USER).records).toHaveLength(1);
    });

    it('removes one record and clears the synced list', () => {
      const { record } = enqueue(USER, payload());
      removeRecord(USER, record.clientRef);
      expect(loadQueue(USER).records).toHaveLength(0);

      localStorage.setItem(queueKey(USER), JSON.stringify({ records: [], synced: [{ clientRef: 'x' }] }));
      clearSynced(USER);
      expect(loadQueue(USER).synced).toHaveLength(0);
    });

    it('makes a v4 UUID even without crypto.randomUUID (plain http on a camp network)', () => {
      const original = globalThis.crypto.randomUUID;
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
      try {
        expect(makeClientRef()).toMatch(UUID_PATTERN);
      } finally {
        Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
      }
    });

    it('shows the first 8 characters of the clientRef as the temporary bag reference', () => {
      expect(tempRef('3f2a9c1b-0d4e-4f6a-9b8c-1a2b3c4d5e6f')).toBe('3F2A9C1B');
    });
  });

  describe('syncQueue', () => {
    it('moves created and already-synced records to the synced list with their unit', async () => {
      fill(2);
      const fetchFn = vi.fn(async (path, options) => {
        const { records } = JSON.parse(options.body);
        return okResponse([
          { clientRef: records[0].clientRef, status: 201, unit: { unitId: 'U-2026-000010' } },
          { clientRef: records[1].clientRef, status: 200, unit: { unitId: 'U-2026-000009' } },
        ]);
      });

      const result = await syncQueue(USER, { fetchFn });

      expect(fetchFn).toHaveBeenCalledWith('/api/donations/sync', expect.objectContaining({ method: 'POST' }));
      expect(result).toEqual(expect.objectContaining({ created: 1, alreadySynced: 1, rejected: 0, stopped: null }));
      const queue = loadQueue(USER);
      expect(queue.records).toHaveLength(0);
      expect(queue.synced.map((s) => s.unit.unitId).sort()).toEqual(['U-2026-000009', 'U-2026-000010']);
    });

    it('keeps rejected records in the queue with the server error', async () => {
      fill(1);
      const fetchFn = answerAll(422, { message: 'Donor is not eligible to donate', code: 'DONOR_NOT_ELIGIBLE' });

      const result = await syncQueue(USER, { fetchFn });

      expect(result.rejected).toBe(1);
      const [record] = rejectedRecords(loadQueue(USER));
      expect(record.error).toEqual(expect.objectContaining({ status: 422, code: 'DONOR_NOT_ELIGIBLE' }));
    });

    it('keeps a record that failed with a per-record 500 as PENDING', async () => {
      fill(1);
      await syncQueue(USER, { fetchFn: answerAll(500) });
      expect(pendingRecords(loadQueue(USER))).toHaveLength(1);
    });

    it(`sends ${SYNC_CHUNK_SIZE + 1} records as two requests, one after another (50 then 1)`, async () => {
      fill(SYNC_CHUNK_SIZE + 1);
      let active = 0;
      let maxActive = 0;
      const inner = answerAll(201);
      const fetchFn = vi.fn(async (...args) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return inner(...args);
      });

      const result = await syncQueue(USER, { fetchFn });

      const sizes = fetchFn.mock.calls.map(([, options]) => JSON.parse(options.body).records.length);
      expect(sizes).toEqual([50, 1]);
      expect(maxActive).toBe(1);
      expect(result.created).toBe(SYNC_CHUNK_SIZE + 1);
      expect(loadQueue(USER).records).toHaveLength(0);
    });

    it.each([
      ['a network error', () => Promise.reject(new TypeError('Failed to fetch')), 'NETWORK'],
      ['a 503', () => Promise.resolve({ status: 503, json: async () => ({}) }), 'SERVER'],
    ])('stops on %s in chunk 2: chunk 1 results kept, later chunks untouched', async (label, failure, stopped) => {
      fill(SYNC_CHUNK_SIZE * 2 + 5);
      const firstChunk = answerAll(201);
      const fetchFn = vi.fn()
        .mockImplementationOnce(firstChunk)
        .mockImplementationOnce(failure);

      const result = await syncQueue(USER, { fetchFn });

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result).toEqual(expect.objectContaining({ created: SYNC_CHUNK_SIZE, stopped }));
      const queue = loadQueue(USER);
      expect(queue.synced).toHaveLength(SYNC_CHUNK_SIZE);
      expect(pendingRecords(queue)).toHaveLength(SYNC_CHUNK_SIZE + 5);
    });

    it('keeps the whole queue and reports authExpired on a 401 (expired login)', async () => {
      fill(3);
      const before = loadQueue(USER);

      const result = await syncQueue(USER, {
        fetchFn: vi.fn().mockResolvedValue({ status: 401, json: async () => ({ message: 'Invalid or expired token' }) }),
      });

      expect(result).toEqual(expect.objectContaining({ stopped: 'AUTH', authExpired: true }));
      expect(loadQueue(USER)).toEqual(before);
    });

    it('skips REJECTED records unless includeRejected is set', async () => {
      fill(2);
      const queue = loadQueue(USER);
      queue.records[0] = { ...queue.records[0], state: 'REJECTED', error: { status: 422 } };
      localStorage.setItem(queueKey(USER), JSON.stringify(queue));
      const rejectedRef = queue.records[0].clientRef;

      const auto = answerAll(201);
      await syncQueue(USER, { fetchFn: auto });
      const autoRefs = JSON.parse(auto.mock.calls[0][1].body).records.map((r) => r.clientRef);
      expect(autoRefs).not.toContain(rejectedRef);
      expect(rejectedRecords(loadQueue(USER))).toHaveLength(1);

      const manual = answerAll(201);
      await syncQueue(USER, { fetchFn: manual, includeRejected: true });
      const manualRefs = JSON.parse(manual.mock.calls[0][1].body).records.map((r) => r.clientRef);
      expect(manualRefs).toEqual([rejectedRef]);
      expect(loadQueue(USER).records).toHaveLength(0);
    });

    it('sends nothing when the queue is empty', async () => {
      const fetchFn = vi.fn();
      await syncQueue(USER, { fetchFn });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('ignores a second sync while one is already running', async () => {
      fill(1);
      let release;
      const fetchFn = vi.fn(() => new Promise((resolve) => { release = resolve; }));

      const first = syncQueue(USER, { fetchFn });
      const second = await syncQueue(USER, { fetchFn });
      expect(second.skipped).toBe(true);

      release({ status: 503, json: async () => ({}) });
      await first;
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('keeps records added while a sync request is in flight', async () => {
      fill(1);
      const inner = answerAll(201);
      const fetchFn = vi.fn(async (...args) => {
        enqueue(USER, payload(99));
        return inner(...args);
      });

      await syncQueue(USER, { fetchFn });

      const queue = loadQueue(USER);
      expect(pendingRecords(queue)).toHaveLength(1);
      expect(queue.records[0].payload.donorId).toBe('D-000099');
    });
  });
});
