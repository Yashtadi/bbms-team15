import { useState } from 'react';
import UnitLabel from './UnitLabel';
import { tempRef } from '../offlineQueue';
import './CampMode.css';

// BBMS-F-013: shows how many camp records are waiting, syncs them, lists rejected records
// with the server's reason, and prints barcode labels for records that have synced.

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function stopMessage(lastResult, waiting) {
  if (!lastResult?.stopped) return null;
  if (lastResult.authExpired) {
    return `Your login has expired. Log in again to sync ${plural(waiting, 'record')}.`;
  }
  if (lastResult.stopped === 'NETWORK') {
    return 'Could not reach the server. Records are kept and will sync when the connection returns.';
  }
  return 'The server could not sync right now. Records are kept; try Sync now again later.';
}

function RejectedRecord({ record, onRemove }) {
  const [confirming, setConfirming] = useState(false);
  const fieldErrors = record.error?.errors ? Object.values(record.error.errors) : [];

  return (
    <li className="camp-record camp-record-rejected" data-testid="rejected-record">
      <div className="camp-record-main">
        <span className="camp-ref">{tempRef(record.clientRef)}</span>
        <span>{record.payload.donorId}</span>
        <span className="camp-record-error">{record.error?.message}</span>
        {fieldErrors.length > 0 && (
          <ul className="camp-field-errors">
            {fieldErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
      {confirming ? (
        <div className="camp-record-actions">
          <span>Remove this record?</span>
          <button type="button" className="btn-secondary" onClick={() => onRemove(record.clientRef)}>
            Confirm remove
          </button>
          <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>
          Remove
        </button>
      )}
    </li>
  );
}

export default function CampSyncBar({
  online,
  syncing,
  lastResult,
  pending,
  rejected,
  synced,
  onSyncNow,
  onRemove,
  onClearSynced,
}) {
  const [labelRef, setLabelRef] = useState(null);

  const waiting = pending.length + rejected.length;
  const message = stopMessage(lastResult, waiting);
  const labelRecord = synced.find((s) => s.clientRef === labelRef && s.unit);

  // Nothing to show while online with an empty queue
  if (online && waiting === 0 && synced.length === 0 && !message) return null;

  const status = online
    ? `${plural(pending.length, 'record')} pending sync`
    : `Offline — ${plural(pending.length, 'record')} pending sync`;

  return (
    <section className="camp-sync-bar" aria-label="Camp records sync">
      <div className="camp-sync-header">
        <span
          className={online ? 'camp-sync-status' : 'camp-sync-status camp-sync-status-offline'}
          role="status"
          data-testid="camp-sync-status"
        >
          {status}
          {rejected.length > 0 && ` · ${plural(rejected.length, 'rejected record')}`}
        </span>
        <button
          type="button"
          className="btn-primary"
          onClick={onSyncNow}
          disabled={!online || syncing || waiting === 0}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {message && (
        <div className="alert-box alert-error" role="alert">
          {message}
        </div>
      )}

      {rejected.length > 0 && (
        <div className="camp-sync-section">
          <h3>Rejected at sync</h3>
          <p className="subtitle">
            Fix the cause (for example, record consent or clear a deferral), then press Sync now to send these
            again. Remove a record only if it can never be saved.
          </p>
          <ul className="camp-record-list">
            {rejected.map((record) => (
              <RejectedRecord key={record.clientRef} record={record} onRemove={onRemove} />
            ))}
          </ul>
        </div>
      )}

      {synced.length > 0 && (
        <div className="camp-sync-section">
          <h3>Synced — print labels</h3>
          <ul className="camp-record-list">
            {synced.map((entry) => (
              <li key={entry.clientRef} className="camp-record" data-testid="synced-record">
                <div className="camp-record-main">
                  <span className="camp-ref">{tempRef(entry.clientRef)}</span>
                  <span>{entry.donorId}</span>
                  <strong>{entry.unit?.unitId}</strong>
                </div>
                {entry.unit && (
                  <button type="button" className="btn-secondary" onClick={() => setLabelRef(entry.clientRef)}>
                    Show label
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-link" onClick={onClearSynced}>
            Clear synced list
          </button>
        </div>
      )}

      {labelRecord && (
        <div className="camp-label-preview">
          <UnitLabel unit={labelRecord.unit} />
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            Print label
          </button>
        </div>
      )}
    </section>
  );
}
