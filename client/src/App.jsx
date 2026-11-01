import { useState } from 'react';
import DonorRegistrationForm from './components/DonorRegistrationForm';
import DonationVitalsForm from './components/DonationVitalsForm';
import UnitLabelLookup from './components/UnitLabelLookup';
import LabWorkflow from './components/LabWorkflow';
import LoginForm from './components/LoginForm';
import { getSession, clearSession } from './api';
import './App.css';
import './components/DonorRegistrationForm.css';

// BBMS-F-012 & F-020: roles permitted to access unit labels and lab screening
const UNIT_LABEL_ROLES = ['LAB_TECH', 'MANAGER', 'ADMIN'];
const LAB_STAFF_ROLES = ['LAB_TECH', 'MANAGER', 'ADMIN'];

export default function App({ initialTab } = {}) {
  const [session, setSession] = useState(getSession);
  const [activeTab, setActiveTab] = useState(initialTab || 'donors');

  const handleLogout = () => {
    clearSession();
    setSession(null);
  };

  if (!session) {
    return <LoginForm onLogin={setSession} />;
  }

  const role = session.user?.role;
  const canSeeVitals = role === 'LAB_TECH';
  const canSeeLabels = UNIT_LABEL_ROLES.includes(role);
  const canSeeLab = LAB_STAFF_ROLES.includes(role);

  // Fallback to 'donors' tab if the activeTab is restricted for this role
  const effectiveTab =
    (activeTab === 'vitals' && !canSeeVitals) ||
    (activeTab === 'units' && !canSeeLabels) ||
    (activeTab === 'lab' && !canSeeLab)
      ? 'donors'
      : activeTab;

  return (
    <div className="app-layout">
      {/* Top Glassmorphic Navigation Header */}
      <header className="app-header">
        <div className="header-container">
          <div className="brand-section">
            <div className="brand-icon">
              <DropIcon />
            </div>
            <div className="brand-text">
              <h1>Blood Bank Management System</h1>
              <p>Team 15 · Sprint 2</p>
            </div>
          </div>

          {/* Segmented Navigation Tabs */}
          <nav className="nav-tabs" role="tablist" aria-label="Main Navigation">
            <button
              type="button"
              role="tab"
              aria-selected={effectiveTab === 'donors'}
              className={`tab-btn ${effectiveTab === 'donors' ? 'active' : ''}`}
              onClick={() => setActiveTab('donors')}
            >
              <span className="tab-icon">📝</span>
              <span>Donors</span>
            </button>

            {canSeeVitals && (
              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'vitals'}
                className={`tab-btn ${effectiveTab === 'vitals' ? 'active' : ''}`}
                onClick={() => setActiveTab('vitals')}
              >
                <span className="tab-icon">🩺</span>
                <span>Donation Vitals</span>
              </button>
            )}

            {canSeeLabels && (
              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'units'}
                className={`tab-btn ${effectiveTab === 'units' ? 'active' : ''}`}
                onClick={() => setActiveTab('units')}
              >
                <span className="tab-icon">🏷️</span>
                <span>Unit Labels</span>
              </button>
            )}

            {canSeeLab && (
              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'lab'}
                className={`tab-btn ${effectiveTab === 'lab' ? 'active' : ''}`}
                onClick={() => setActiveTab('lab')}
              >
                <span className="tab-icon">🔬</span>
                <span>Lab Screening</span>
              </button>
            )}
          </nav>

          {/* User Profile Bar */}
          <div className="user-bar">
            <div className="user-pill">
              <div className="user-avatar">
                {session.user?.fullName ? session.user.fullName[0].toUpperCase() : 'U'}
              </div>
              <span className="user-name">{session.user?.fullName}</span>
              <span className={`role-badge role-badge-${role}`}>{role}</span>
            </div>
            <button type="button" className="btn-logout" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Display */}
      <main className="app-content">
        {effectiveTab === 'donors' && <DonorRegistrationForm />}
        {effectiveTab === 'vitals' && canSeeVitals && <DonationVitalsForm />}
        {effectiveTab === 'units' && canSeeLabels && <UnitLabelLookup />}
        {effectiveTab === 'lab' && canSeeLab && (
          <LabWorkflow canEnterResults={role === 'LAB_TECH'} />
        )}
      </main>
    </div>
  );
}

function DropIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c-3.6 4.7-6.5 8.4-6.5 11.7a6.5 6.5 0 0 0 13 0c0-3.3-2.9-7-6.5-11.7z" />
    </svg>
  );
}
