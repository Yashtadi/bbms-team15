import { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import DonorCard from './DonorCard';
import './DonorPortalDashboard.css';

/**
 * Format date nicely for human display.
 */
function formatHumanDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(dateStr);
  }
}

export default function DonorPortalDashboard({ onLogout }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [portalData, setPortalData] = useState(null);

  // Change Password state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    fetchPortalData();
  }, []);

  const fetchPortalData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/donors/portal/me');
      if (res.status === 200) {
        const data = await res.json();
        setPortalData(data);
      } else if (res.status === 401) {
        if (onLogout) onLogout();
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.message || 'Failed to load donor profile.');
      }
    } catch {
      setError('Network error connecting to the server. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All password fields are required.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordError('New password must be different from current password.');
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 200) {
        setPasswordSuccess('Password successfully updated! You can now use your new password.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordError(data.message || 'Failed to update password.');
      }
    } catch {
      setPasswordError('Network error updating password. Please try again.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="portal-loading" data-testid="portal-loading">
        <div className="spinner"></div>
        <p>Loading your donor profile and donation records...</p>
      </div>
    );
  }

  if (error || !portalData) {
    return (
      <div className="portal-error" data-testid="portal-error">
        <div className="alert-box alert-error">{error || 'Donor record not found.'}</div>
        <button type="button" className="btn-primary" onClick={fetchPortalData}>
          Try Again
        </button>
      </div>
    );
  }

  const { donor, stats, history } = portalData;

  return (
    <div className="donor-portal-container" data-testid="donor-portal">
      {/* Top Welcome & Profile Header */}
      <div className="portal-welcome-header">
        <div className="welcome-text-col">
          <span className="welcome-tag">DONOR SELF-SERVICE PORTAL</span>
          <h2 data-testid="portal-donor-name">Welcome, {donor.fullName}</h2>
          <p className="welcome-subtitle">
            Donor ID: <strong>{donor.donorCode}</strong>
            {donor.bloodGroup ? <> · Blood Group: <strong>{donor.bloodGroup}</strong></> : null}
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn-change-password-toggle"
            onClick={() => setShowPasswordModal(!showPasswordModal)}
            data-testid="toggle-change-password"
          >
            {showPasswordModal ? 'Close Password Form' : 'Change Password'}
          </button>
        </div>
      </div>

      {/* Change Password Panel / Modal */}
      {showPasswordModal && (
        <div className="password-change-card" data-testid="change-password-form">
          <h3>Change Your Account Password</h3>
          <p className="password-card-sub">
            If you recently registered with your default DOB password (DDMMYYYY), update it to a secure personal password.
          </p>

          {passwordSuccess && (
            <div className="alert-box alert-success" data-testid="password-success">
              {passwordSuccess}
            </div>
          )}

          {passwordError && (
            <div className="alert-box alert-error" data-testid="password-error">
              {passwordError}
            </div>
          )}

          <form onSubmit={handlePasswordSubmit}>
            <div className="form-group">
              <label htmlFor="currentPassword">Current Password *</label>
              <input
                id="currentPassword"
                type="password"
                placeholder="Enter current password (or default DDMMYYYY)"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="newPassword">New Password (min 6 chars) *</label>
                <input
                  id="newPassword"
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm New Password *</label>
                <input
                  id="confirmPassword"
                  type="password"
                  placeholder="Re-type new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="password-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={isChangingPassword}
                data-testid="submit-change-password"
              >
                {isChangingPassword ? 'Updating Password...' : 'Save New Password'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowPasswordModal(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Key Metrics / Impact Tiles */}
      <div className="portal-metrics-grid">
        <div className="metric-card" data-testid="metric-donations">
          <span className="metric-label">Completed Donations</span>
          <span className="metric-value">{stats.totalDonations}</span>
          <span className="metric-sub">Lifetime contributions</span>
        </div>

        <div className="metric-card" data-testid="metric-volume">
          <span className="metric-label">Total Volume Given</span>
          <span className="metric-value">{stats.totalVolumeMl} mL</span>
          <span className="metric-sub">Pure whole blood/components</span>
        </div>

        <div
          className={`metric-card ${stats.isEligibleNow ? 'metric-eligible' : 'metric-waiting'}`}
          data-testid="metric-eligibility"
        >
          <span className="metric-label">Donation Eligibility</span>
          <span className="metric-value">
            {stats.isEligibleNow ? 'Eligible Today' : stats.daysUntilEligible > 0 ? `In ${stats.daysUntilEligible} Days` : 'Deferred'}
          </span>
          <span className="metric-sub">
            {stats.isEligibleNow
              ? 'Ready for your next donation'
              : stats.nextEligibleDate
                ? `Next eligible: ${formatHumanDate(stats.nextEligibleDate)}`
                : stats.eligibilityReason || 'Rest period active'}
          </span>
        </div>
      </div>

      {/* Main Two-Column Layout: Digital Card Showcase + History */}
      <div className="portal-content-grid">
        {/* Left Column: Official Digital Card */}
        <div className="portal-card-section">
          <h3>Your Digital Donor Card</h3>
          <p className="section-sub">
            Present this card or scan the barcode at any blood bank facility or donation camp.
          </p>

          <DonorCard donor={donor} showActions={true} />
        </div>

        {/* Right Column: Donation History Timeline */}
        <div className="portal-history-section">
          <h3>Donation History</h3>
          <p className="section-sub">
            Verified records of previous donations and clinical observations.
          </p>

          {history.length === 0 ? (
            <div className="history-empty-state" data-testid="history-empty">
              <p>No completed blood donations recorded on this profile yet.</p>
              <span className="empty-sub">
                Once you complete your draw at the collection desk, your volume and vitals will appear here.
              </span>
            </div>
          ) : (
            <div className="history-list" data-testid="history-list">
              {history.map((item) => (
                <div key={item.id} className="history-item-card" data-testid="history-item">
                  <div className="history-header">
                    <div>
                      <strong className="history-date">{formatHumanDate(item.collectedAt)}</strong>
                      <span className="history-volume">{item.volumeMl} mL Collected</span>
                    </div>
                    <span className="history-badge status-completed">COMPLETED</span>
                  </div>

                  {item.vitals && (
                    <div className="history-vitals-row">
                      {item.vitals.hemoglobin && (
                        <span>Hb: <strong>{item.vitals.hemoglobin} g/dL</strong></span>
                      )}
                      {item.vitals.bloodPressure && (
                        <span>BP: <strong>{item.vitals.bloodPressure}</strong></span>
                      )}
                      {item.vitals.weightKg && (
                        <span>Weight: <strong>{item.vitals.weightKg} kg</strong></span>
                      )}
                      {item.vitals.pulse && (
                        <span>Pulse: <strong>{item.vitals.pulse} bpm</strong></span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
