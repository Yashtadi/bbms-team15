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
  const [bloodGroup, setBloodGroup] = useState(EMPTY_BLOOD_GROUP);
  const [tti, setTti] = useState(EMPTY_TTI);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsError, setNotificationsError] = useState('');
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true);

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

    return () => {
      active = false;
    };
  }, [fetchNotifications]);

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

  return (
    <section className="lab-workflow registration-form-container">
      <h2>Lab Screening</h2>
      <p className="subtitle">BBMS-F-020 to F-023 · Verify blood group and record infection screening</p>

      {canEnterResults && (
        <>
          <div className="form-group">
            <label htmlFor="lab-donation-id">Donation ID *</label>
            <input
              id="lab-donation-id"
              type="number"
              min="1"
              value={donationId}
              onChange={(e) => setDonationId(e.target.value)}
              placeholder="e.g. 21"
            />
          </div>

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
              <h3>TTI screening</h3>
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
      )}

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
