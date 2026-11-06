import { useCallback, useEffect, useState } from 'react';
import {
  loadQueue,
  enqueue,
  removeRecord,
  clearSynced,
  syncQueue,
  pendingRecords,
  rejectedRecords,
} from './offlineQueue';

// BBMS-F-013: React state for the offline camp queue.
// - Automatic syncs (connection back, app opened, record saved while online) send PENDING records only.
// - "Sync now" also re-sends REJECTED records, e.g. once a deferred donor has been cleared.

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export default function useCampQueue(userId) {
  const [queue, setQueue] = useState(() => loadQueue(userId));
  const [online, setOnline] = useState(isOnline);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const refresh = useCallback(() => setQueue(loadQueue(userId)), [userId]);

  const sync = useCallback(
    async ({ includeRejected = false } = {}) => {
      setSyncing(true);
      try {
        const result = await syncQueue(userId, { includeRejected });
        if (!result.skipped) setLastResult(result);
        return result;
      } finally {
        setSyncing(false);
        refresh();
      }
    },
    [userId, refresh]
  );

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      sync({ includeRejected: false });
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [sync]);

  // The connection may have come back while the app was closed. Started from a timer so the
  // cleanup can cancel it (e.g. React StrictMode mounting twice).
  useEffect(() => {
    if (!isOnline() || pendingRecords(loadQueue(userId)).length === 0) return undefined;
    const timer = setTimeout(() => sync({ includeRejected: false }), 0);
    return () => clearTimeout(timer);
  }, [userId, sync]);

  const add = useCallback(
    (payload) => {
      const result = enqueue(userId, payload);
      refresh();
      if (result.ok && isOnline()) sync({ includeRejected: false });
      return result;
    },
    [userId, refresh, sync]
  );

  const remove = useCallback(
    (clientRef) => {
      removeRecord(userId, clientRef);
      refresh();
    },
    [userId, refresh]
  );

  const clearSyncedList = useCallback(() => {
    clearSynced(userId);
    refresh();
  }, [userId, refresh]);

  const syncNow = useCallback(() => sync({ includeRejected: true }), [sync]);

  return {
    online,
    syncing,
    lastResult,
    pending: pendingRecords(queue),
    rejected: rejectedRecords(queue),
    synced: queue.synced,
    add,
    remove,
    clearSynced: clearSyncedList,
    syncNow,
  };
}
