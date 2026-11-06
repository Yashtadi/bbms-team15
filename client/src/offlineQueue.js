// BBMS-F-013: browser-side queue for donations recorded at outreach camps.
//
// Camp records are always saved here first, then sent to POST /api/donations/sync.
// Each record has a clientRef (a UUID made here). The server saves a clientRef only once,
// so sending a record again (after a timeout, a crash or a double click) never makes a duplicate.
//
// The queue lives in localStorage, one key per logged-in user, so it survives logout and a
// page reload, and one collector never syncs another collector's records. Every storage
// call is wrapped in try/catch because storage can be blocked or full.

import { apiFetch } from './api';

const KEY_PREFIX = 'bbms.campQueue.';
export const SYNC_CHUNK_SIZE = 50; // the server accepts at most 50 records per request
const MAX_SYNCED_KEPT = 50; // synced records are kept for label printing until cleared

// Per-record statuses that mean "the server looked at it and said no".
// The record stays in the queue as REJECTED, with the error shown.
const REJECTED_STATUSES = [400, 404, 422];

export function queueKey(userId) {
  return `${KEY_PREFIX}${userId ?? 'anonymous'}`;
}

function emptyQueue() {
  return { records: [], synced: [] };
}

export function loadQueue(userId) {
  try {
    const raw = localStorage.getItem(queueKey(userId));
    if (!raw) return emptyQueue();
    const parsed = JSON.parse(raw);
    return {
      records: Array.isArray(parsed?.records) ? parsed.records : [],
      synced: Array.isArray(parsed?.synced) ? parsed.synced : [],
    };
  } catch {
    return emptyQueue();
  }
}

function saveQueue(userId, queue) {
  try {
    localStorage.setItem(queueKey(userId), JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}

// crypto.randomUUID only exists on https or localhost; getRandomValues works everywhere.
export function makeClientRef() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Short reference written on the bag until its barcode label is printed after sync.
export function tempRef(clientRef) {
  return String(clientRef).slice(0, 8).toUpperCase();
}

export function pendingRecords(queue) {
  return queue.records.filter((r) => r.state === 'PENDING');
}

export function rejectedRecords(queue) {
  return queue.records.filter((r) => r.state === 'REJECTED');
}

/**
 * Adds a camp record to the queue.
 * @returns {{ ok: boolean, record?: object }} ok is false if the browser would not save it
 */
export function enqueue(userId, payload, now = new Date()) {
  const clientRef = makeClientRef();
  const record = {
    clientRef,
    createdAt: now.toISOString(),
    payload: { ...payload, clientRef },
    state: 'PENDING',
    error: null,
  };
  const queue = loadQueue(userId);
  queue.records.push(record);
  return saveQueue(userId, queue) ? { ok: true, record } : { ok: false };
}

export function removeRecord(userId, clientRef) {
  const queue = loadQueue(userId);
  queue.records = queue.records.filter((r) => r.clientRef !== clientRef);
  saveQueue(userId, queue);
}

export function clearSynced(userId) {
  const queue = loadQueue(userId);
  queue.synced = [];
  saveQueue(userId, queue);
}

// Applies one chunk's results. The queue is re-read first, so records added while the
// request was in flight are kept.
function applyResults(userId, results, totals) {
  const queue = loadQueue(userId);
  const byRef = new Map(results.map((result) => [result.clientRef, result]));
  const remaining = [];

  queue.records.forEach((record) => {
    const result = byRef.get(record.clientRef);
    if (!result) {
      remaining.push(record);
      return;
    }

    if (result.status === 201 || result.status === 200) {
      totals[result.status === 201 ? 'created' : 'alreadySynced'] += 1;
      queue.synced.unshift({
        clientRef: record.clientRef,
        donorId: record.payload.donorId,
        campLocation: record.payload.campLocation,
        unit: result.unit || null,
        syncedAt: new Date().toISOString(),
      });
      return;
    }

    if (REJECTED_STATUSES.includes(result.status)) {
      totals.rejected += 1;
      remaining.push({
        ...record,
        state: 'REJECTED',
        error: {
          status: result.status,
          message: result.message || 'Rejected by the server',
          errors: result.errors || null,
          code: result.code || null,
        },
      });
      return;
    }

    // Anything else (e.g. a 500 for this one record): keep it as it was and try again later
    remaining.push(record);
  });

  queue.records = remaining;
  queue.synced = queue.synced.slice(0, MAX_SYNCED_KEPT);
  saveQueue(userId, queue);
}

const inFlight = new Set();

/**
 * Sends queued records to the server in chunks of 50, one chunk after another.
 *
 * - includeRejected false (automatic sync): PENDING records only.
 * - includeRejected true ("Sync now"): REJECTED records are sent again too, e.g. after a
 *   deferred donor has been cleared.
 * - A network error, 401 or any other non-200 response stops the sync. That chunk and every
 *   later one stay in the queue untouched; earlier chunks keep their results.
 *
 * @returns {Promise<{ created: number, alreadySynced: number, rejected: number,
 *   stopped: null|'NETWORK'|'AUTH'|'SERVER', authExpired: boolean, skipped?: boolean }>}
 */
export async function syncQueue(userId, { includeRejected = false, fetchFn = apiFetch } = {}) {
  const totals = { created: 0, alreadySynced: 0, rejected: 0, stopped: null, authExpired: false };
  if (inFlight.has(userId)) return { ...totals, skipped: true };

  inFlight.add(userId);
  try {
    const toSend = loadQueue(userId).records.filter(
      (r) => r.state === 'PENDING' || (includeRejected && r.state === 'REJECTED')
    );

    for (let start = 0; start < toSend.length; start += SYNC_CHUNK_SIZE) {
      const chunk = toSend.slice(start, start + SYNC_CHUNK_SIZE);

      let response;
      try {
        response = await fetchFn('/api/donations/sync', {
          method: 'POST',
          body: JSON.stringify({ records: chunk.map((r) => r.payload) }),
        });
      } catch {
        return { ...totals, stopped: 'NETWORK' };
      }

      if (response.status === 401) {
        return { ...totals, stopped: 'AUTH', authExpired: true };
      }
      if (response.status !== 200) {
        return { ...totals, stopped: 'SERVER' };
      }

      let data;
      try {
        data = await response.json();
      } catch {
        return { ...totals, stopped: 'SERVER' };
      }
      if (!Array.isArray(data?.results)) {
        return { ...totals, stopped: 'SERVER' };
      }

      applyResults(userId, data.results, totals);
    }

    return totals;
  } finally {
    inFlight.delete(userId);
  }
}
