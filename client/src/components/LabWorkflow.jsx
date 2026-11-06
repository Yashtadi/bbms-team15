import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import './LabWorkflow.css';

const TTI_TESTS = ['HIV', 'HBV', 'HCV', 'SYPHILIS', 'MALARIA'];
const EMPTY_BLOOD_GROUP = { aboGroup: 'A', rh: '+' };
const EMPTY_TTI = { testType: 'HIV', result: 'NON_REACTIVE', method: 'ELISA' };

async function responseData(response) {
  return response.json().catch(() => ({}));
}

export default function LabWorkflow({ canEnterResults }) {
  const [donationId, setDonationId] = useState('');
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [bloodGroup, setBloodGroup] = useState(EMPTY_BLOOD_GROUP);
  const [tti, setTti] = useState(EMPTY_TTI);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsError, setNotificationsError] = useState('');
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true);

  // Testing Queue states
  const [queue, setQueue] = useState([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  const QUEUE_PAGE_SIZE = 6;

  const fetchNotifications = useCallback(async () => {
    const response = await apiFetch('/api/lab/notifications');
    const data = await responseData(response);
    if (response.status !== 200) {
      throw new Error(data.message || 'Unable to load confidential notifications.');
    }
    return data.notifications || [];
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      setNotifications(await fetchNotifications());
      setNotificationsError('');
    } catch (loadError) {
      setNotificationsError(loadError.message || 'Network error: unable to load confidential notifications.');
    } finally {
      setIsLoadingNotifications(false);
    }
  }, [fetchNotifications]);

  const fetchQueue = useCallback(async () => {
    try {
      const response = await apiFetch('/api/lab/queue');
      const data = await responseData(response);
      if (response.status === 200) {
        return data.queue || [];
      }
      return [];
    } catch {
      return [];
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setIsLoadingQueue(true);
    try {
      const items = await fetchQueue();
      setQueue(items);
    } catch {
      setQueue([]);
    } finally {
      setIsLoadingQueue(false);
    }
  }, [fetchQueue]);

  useEffect(() => {
    let active = true;
    fetchNotifications()
      .then((items) => {
        if (active) setNotifications(items);
      })
      .catch((loadError) => {
        if (active) {
          setNotificationsError(
            loadError.message || 'Network error: unable to load confidential notifications.',
          );
        }
      })
      .finally(() => {
        if (active) setIsLoadingNotifications(false);
      });

    fetchQueue()
      .then((items) => {
        if (active) {
          setQueue(items);
        }
      })
      .finally(() => {
        if (active) setIsLoadingQueue(false);
      });

    return () => {
      active = false;
    };
  }, [fetchNotifications, fetchQueue]);

  const selectUnitForTesting = (item) => {
    setDonationId(String(item.donationId));
    setSelectedUnit(item);
    setMessage('');
    setError('');

    // Pre-fill ABO if recorded
    if (item.abo?.result) {
      const match = item.abo.result.match(/^([A-Z]+)([+-])$/);
      if (match) {
        setBloodGroup({ aboGroup: match[1], rh: match[2] });
      }
    }

    // Pre-fill next missing TTI test
    if (item.tti?.remaining?.length > 0) {
      setTti((curr) => ({ ...curr, testType: item.tti.remaining[0] }));
    }
  };

  const submitResult = async (e, path, body, successMessage) => {
    e.preventDefault();
    setMessage('');
    setError('');
    if (!donationId.trim()) {
      setError('Donation ID is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiFetch(
        `/api/lab/donations/${encodeURIComponent(donationId.trim())}/${path}`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      const data = await responseData(response);
      if (response.status === 200 || response.status === 201) {
        setMessage(successMessage(data));
        await loadQueue();
        if (data.result === 'REACTIVE') await loadNotifications();
      } else {
        setError(`${data.message || 'Unable to save lab result.'}${data.flagged ? ' This mismatch has been flagged.' : ''}`);
      }
    } catch {
      setError('Network error: unable to connect to the server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Sort testing queue strictly First In First Out (oldest collected blood tested first)
  const fifoQueue = [...queue].sort((a, b) => {
    const timeDiff = new Date(a.collectedAt).getTime() - new Date(b.collectedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (a.donationId || 0) - (b.donationId || 0);
  });

  const totalPages = Math.max(1, Math.ceil(fifoQueue.length / QUEUE_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * QUEUE_PAGE_SIZE;
  const visibleCards = fifoQueue.slice(startIndex, startIndex + QUEUE_PAGE_SIZE);

  return (
    <section className="lab-workflow registration-form-container">
      {/* Clean Header */}
      <div className="lab-header-row">
        <div>
          <h2>Lab Screening</h2>
          <p className="subtitle">
            BBMS-F-020 to F-023 · Verify blood groups, record 5 mandatory infection tests, and release units to inventory
          </p>
        </div>
      </div>

      {/* Newly Donated Blood Queue (Testing Queue) */}
      <section className="lab-queue-section" aria-label="Newly Donated Blood Queue">
        <div className="queue-section-header">
          <div className="queue-title-group">
            <h3>Newly Donated Blood — Testing Queue</h3>
            <span className="queue-counter-badge">
              {fifoQueue.length} {fifoQueue.length === 1 ? 'Unit' : 'Units'} Awaiting Screening (FIFO)
            </span>
          </div>
          <button
            type="button"
            className="btn-refresh-queue"
            onClick={loadQueue}
            disabled={isLoadingQueue}
            title="Refresh queue"
          >
            Refresh Queue
          </button>
        </div>

        {isLoadingQueue && <p className="queue-loading">Loading pending donations...</p>}

        {!isLoadingQueue && fifoQueue.length === 0 && (
          <div className="queue-empty-box">
            <span className="empty-icon">✓</span>
            <div>
              <strong>All blood collections have been tested!</strong>
              <p>No new units waiting in quarantine. Check the Storage &amp; Inventory tab to view released stock.</p>
            </div>
          </div>
        )}

        {!isLoadingQueue && visibleCards.length > 0 && (
          <>
            <div className="lab-queue-grid">
              {visibleCards.map((item) => {
                const isSelected = donationId === String(item.donationId);
                return (
                  <div
                    key={item.unitId || item.donationId}
                    className={`queue-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => selectUnitForTesting(item)}
                  >
                    <div className="card-unit-id">
                      <span className="unit-barcode-pill">{item.unitCode}</span>
                    </div>
                    <div className="card-donation-num">
                      Donation #{item.donationId}
                    </div>

                    <div className="card-donor-info">
                      <strong>{item.donorName}</strong>
                      <span className="donor-code-sub">({item.donorCode})</span>
                    </div>

                    {item.isSeparated && item.components?.length > 0 && (
                      <div className="card-components" data-testid="card-components">
                        Separated into {item.components.map((c) => c.component).join(', ')}
                      </div>
                    )}
                    <div className="card-blood-type">
                      {item.component} · {item.volumeMl} ml
                    </div>
                    <div className="card-collected-time">
                      {new Date(item.collectedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>

                    {/* Progress Pills */}
                    <div className="card-progress-badges">
                      {/* ABO Progress */}
                      {!item.abo && (
                        <span className="badge badge-pending">ABO: Pending</span>
                      )}
                      {item.abo && item.abo.verificationStatus === 'PENDING' && (
                        <span className="badge badge-warning">ABO: {item.abo.result} (Needs 2nd verify)</span>
                      )}
                      {item.abo && item.abo.verificationStatus === 'VERIFIED' && (
                        <span className="badge badge-success">ABO: {item.abo.result} ✓ Verified</span>
                      )}
                      {item.abo && item.abo.verificationStatus === 'MISMATCH' && (
                        <span className="badge badge-danger">ABO: Mismatch Flagged</span>
                      )}

                      {/* TTI Progress */}
                      {item.tti.completedCount === 0 && (
                        <span className="badge badge-pending">TTI: 0/5 Screened</span>
                      )}
                      {item.tti.completedCount > 0 && item.tti.completedCount < 5 && (
                        <span className="badge badge-info">TTI: {item.tti.completedCount}/5 Screened</span>
                      )}
                      {item.tti.completedCount === 5 && !item.tti.hasReactive && (
                        <span className="badge badge-success">TTI: 5/5 Non-Reactive ✓</span>
                      )}
                      {item.tti.hasReactive && (
                        <span className="badge badge-danger">TTI: Reactive (Discarded)</span>
                      )}
                    </div>

                    <button
                      type="button"
                      className={`btn-card-select ${isSelected ? 'is-selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectUnitForTesting(item);
                      }}
                    >
                      {isSelected ? 'Currently Testing' : 'Select for Testing →'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Pagination Controls when there are more than 6 cards */}
            {totalPages > 1 && (
              <div className="queue-pagination-bar" aria-label="Queue Pagination">
                <button
                  type="button"
                  className="btn-page-nav"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous Page"
                >
                  Previous
                </button>

                <div className="queue-page-indicator">
                  <span>Page {safePage} of {totalPages}</span>
                  <span className="queue-page-count">
                    (Showing {startIndex + 1}–{Math.min(startIndex + QUEUE_PAGE_SIZE, fifoQueue.length)} of {fifoQueue.length})
                  </span>
                </div>

                <button
                  type="button"
                  className="btn-page-nav"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next Page"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Result Entry Workspace */}
      {canEnterResults && (
        <section className="lab-results-workspace" aria-label="Lab Screening Entry">
          {/* Always-visible Search Bar directly below the queue */}
          <div className="form-group donation-id-input-group">
            <label htmlFor="lab-donation-id">Donation ID *</label>
            <div className="donation-search-bar-row">
              <input
                id="lab-donation-id"
                type="text"
                value={donationId}
                onChange={(e) => {
                  const val = e.target.value;
                  setDonationId(val);
                  const matchIndex = fifoQueue.findIndex(
                    (q) => String(q.donationId) === val.trim()
                        || q.unitCode?.toUpperCase() === val.trim().toUpperCase()
                        // BBMS-F-031: a scan of any component of a separated donation finds its ticket
                        || (q.unitCodes || []).some((c) => c.toUpperCase() === val.trim().toUpperCase()),
                  );
                  if (matchIndex !== -1) {
                    setSelectedUnit(fifoQueue[matchIndex]);
                    setCurrentPage(Math.floor(matchIndex / QUEUE_PAGE_SIZE) + 1);
                  } else {
                    setSelectedUnit(null);
                  }
                }}
                placeholder="Select from queue above or type Donation ID (e.g. 1)"
              />
              {donationId && (
                <button
                  type="button"
                  className="btn-clear-input"
                  onClick={() => {
                    setDonationId('');
                    setSelectedUnit(null);
                    setMessage('');
                    setError('');
                  }}
                  title="Clear selection"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Active Unit Banner when selected */}
          {selectedUnit && (
            <div className="active-unit-banner">
              <div className="banner-details">
                <strong>Active Unit: {selectedUnit.unitCode} (Donation #{selectedUnit.donationId})</strong>
                <span>Donor: {selectedUnit.donorName} ({selectedUnit.donorCode}) · {selectedUnit.component} {selectedUnit.volumeMl} ml</span>
              </div>
              <button
                type="button"
                className="btn-clear-selection"
                onClick={() => {
                  setSelectedUnit(null);
                  setDonationId('');
                }}
              >
                Clear
              </button>
            </div>
          )}

          {/* Fill-in-the-blank options: only shown when a ticket is pressed or search bar has an ID entered */}
          {Boolean(donationId.trim() || selectedUnit) ? (
            <>
              <div className="lab-form-grid">
                <form onSubmit={(e) => submitResult(
                  e,
                  'blood-group',
                  bloodGroup,
                  (data) => `Blood group ${data.bloodGroup} recorded and awaiting second-person verification.`,
                )}>
                  <h3>ABO/Rh blood group</h3>
                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor="abo-group">ABO group</label>
                      <select
                        id="abo-group"
                        value={bloodGroup.aboGroup}
                        onChange={(e) => setBloodGroup((current) => ({ ...current, aboGroup: e.target.value }))}
                      >
                        {['A', 'B', 'AB', 'O'].map((group) => <option key={group}>{group}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="rh-factor">Rh factor</label>
                      <select
                        id="rh-factor"
                        value={bloodGroup.rh}
                        onChange={(e) => setBloodGroup((current) => ({ ...current, rh: e.target.value }))}
                      >
                        <option value="+">Positive (+)</option>
                        <option value="-">Negative (-)</option>
                      </select>
                    </div>
                  </div>
                  <button className="btn-primary" type="submit" disabled={isSubmitting}>
                    Record blood group
                  </button>
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={isSubmitting}
                    onClick={(e) => submitResult(
                      e,
                      'blood-group/verify',
                      bloodGroup,
                      (data) => `Blood group ${data.bloodGroup} verified and locked.`,
                    )}
                  >
                    Verify blood group
                  </button>
                </form>

                <form onSubmit={(e) => submitResult(
                  e,
                  'tti-results',
                  tti,
                  (data) => data.result === 'REACTIVE'
                    ? 'Reactive result recorded. The unit was discarded and confidential follow-up notifications were sent.'
                    : `${data.testType} result recorded.`,
                )}>
                  <h3>TTI screening (5 mandatory tests)</h3>
                  <div className="form-group">
                    <label htmlFor="tti-test">Test</label>
                    <select
                      id="tti-test"
                      value={tti.testType}
                      onChange={(e) => setTti((current) => ({ ...current, testType: e.target.value }))}
                    >
                      {TTI_TESTS.map((test) => <option key={test}>{test}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor="tti-result">Result</label>
                      <select
                        id="tti-result"
                        value={tti.result}
                        onChange={(e) => setTti((current) => ({ ...current, result: e.target.value }))}
                      >
                        <option value="NON_REACTIVE">Non-reactive</option>
                        <option value="REACTIVE">Reactive</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="tti-method">Method</label>
                      <select
                        id="tti-method"
                        value={tti.method}
                        onChange={(e) => setTti((current) => ({ ...current, method: e.target.value }))}
                      >
                        <option value="ELISA">ELISA</option>
                        <option value="NAT">NAT</option>
                      </select>
                    </div>
                  </div>
                  <button className="btn-primary" type="submit" disabled={isSubmitting}>
                    Record TTI result
                  </button>
                </form>
              </div>

              {error && <div className="alert-box alert-error" role="alert">{error}</div>}
              {message && <div className="alert-box alert-success" role="status">{message}</div>}
            </>
          ) : (
            <p className="queue-hint-text">
              Select a blood collection ticket from the queue above or enter a Donation ID to view testing options.
            </p>
          )}
        </section>
      )}

      {/* Staff Notifications Section */}
      <section className="lab-notifications" aria-labelledby="lab-notifications-heading">
        <h3 id="lab-notifications-heading">Confidential staff notifications</h3>
        {isLoadingNotifications && <p>Loading notifications...</p>}
        {notificationsError && <p className="field-error" role="alert">{notificationsError}</p>}
        {!isLoadingNotifications && !notificationsError && notifications.length === 0 && (
          <p>No notifications.</p>
        )}
        {notifications.length > 0 && (
          <ul>
            {notifications.map((notification) => (
              <li key={notification.id}>
                <span>{notification.message}</span>
                <time dateTime={notification.created_at}>
                  {new Date(notification.created_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
