import { useState } from 'react';
import CollectionDeskWizard from './components/CollectionDeskWizard';
import DonorRegistrationForm from './components/DonorRegistrationForm';
import UnitLabelLookup from './components/UnitLabelLookup';
import LabWorkflow from './components/LabWorkflow';
import InventoryDashboard from './components/InventoryDashboard';
import LoginForm from './components/LoginForm';
import ThemeToggle from './components/ThemeToggle';
import { getSession, clearSession } from './api';
import './App.css';
import './components/DonorRegistrationForm.css';

// Two Target Groups:
// Group 1: Frontline Clinical & Hospital (Collector + Hospital) -> HOSPITAL role
// Group 2: Central Blood Bank Facility (Tester + Storage Manager) -> LAB_TECH & MANAGER roles
const COLLECTION_ROLES = ['HOSPITAL', 'ADMIN'];
const LAB_STAFF_ROLES = ['LAB_TECH', 'MANAGER', 'ADMIN'];
const INVENTORY_ROLES = ['LAB_TECH', 'MANAGER', 'ADMIN'];
const UNIT_LABEL_ROLES = ['HOSPITAL', 'LAB_TECH', 'MANAGER', 'ADMIN'];

export default function App({ initialTab } = {}) {
  const [session, setSession] = useState(getSession);

  const role = session?.user?.role;
  const canSeeCollection = COLLECTION_ROLES.includes(role);
  const canSeeLab = LAB_STAFF_ROLES.includes(role);
  const canSeeInventory = INVENTORY_ROLES.includes(role);
  const canSeeLabels = UNIT_LABEL_ROLES.includes(role);
  const canSeeDonors = role === 'DONOR';

  // Default landing tab per role
  const getDefaultTab = () => {
    if (role === 'DONOR') return 'donors';
    if (role === 'MANAGER') return 'inventory';
    if (role === 'LAB_TECH') return 'lab';
    if (role === 'HOSPITAL') return 'collection';
    return 'lab';
  };

  const defaultTab = getDefaultTab();
  const [activeTab, setActiveTab] = useState(initialTab || defaultTab);

  const handleLogout = () => {
    clearSession();
    setSession(null);
  };

  if (!session) {
    return <LoginForm onLogin={setSession} />;
  }

  // Fallback if the activeTab is restricted for this role
  const effectiveTab =
    (activeTab === 'collection' && !canSeeCollection) ||
    (activeTab === 'donors' && !canSeeDonors) ||
    (activeTab === 'units' && !canSeeLabels) ||
    (activeTab === 'lab' && !canSeeLab) ||
    (activeTab === 'inventory' && !canSeeInventory)
      ? defaultTab
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
            {canSeeCollection && (
              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'collection'}
                className={`tab-btn ${effectiveTab === 'collection' ? 'active' : ''}`}
                onClick={() => setActiveTab('collection')}
              >
                <span>Collection Desk</span>
              </button>
            )}

            {canSeeDonors && (
              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'donors'}
                className={`tab-btn ${effectiveTab === 'donors' ? 'active' : ''}`}
                onClick={() => setActiveTab('donors')}
              >
                <span>My Donor Card</span>
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
                <span>Lab Screening</span>
              </button>
            )}

            {canSeeInventory && (
              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'inventory'}
                className={`tab-btn ${effectiveTab === 'inventory' ? 'active' : ''}`}
                onClick={() => setActiveTab('inventory')}
              >
                <span>Storage & Inventory</span>
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
                <span>Blood Label Tool</span>
              </button>
            )}
          </nav>

          {/* User Profile Bar & Theme Toggle */}
          <div className="user-bar">
            <ThemeToggle />
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
        {effectiveTab === 'collection' && canSeeCollection && <CollectionDeskWizard />}
        {effectiveTab === 'donors' && canSeeDonors && <DonorRegistrationForm />}
        {effectiveTab === 'lab' && canSeeLab && (
          <LabWorkflow
            canEnterResults={role === 'LAB_TECH'}
            onOpenStorage={() => setActiveTab('inventory')}
          />
        )}
        {effectiveTab === 'inventory' && canSeeInventory && <InventoryDashboard />}
        {effectiveTab === 'units' && canSeeLabels && <UnitLabelLookup />}
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
