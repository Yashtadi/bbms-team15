import { useState } from 'react';
import DonorRegistrationForm from './components/DonorRegistrationForm';
import DonationVitalsForm from './components/DonationVitalsForm';
import UnitLabelLookup from './components/UnitLabelLookup';
import LoginForm from './components/LoginForm';
import { getSession, clearSession } from './api';
import './components/DonorRegistrationForm.css';

// BBMS-F-012: roles that may look up blood units and print their labels (same as the API)
const UNIT_LABEL_ROLES = ['LAB_TECH', 'MANAGER', 'ADMIN'];

function App() {
  const [session, setSession] = useState(getSession);

  const handleLogout = () => {
    clearSession();
    setSession(null);
  };

  if (!session) {
    return <LoginForm onLogin={setSession} />;
  }

  return (
    <main>
      <h1>Blood Bank Management System</h1>
      <p>Team 15 · Sprint 2</p>

      <div className="user-bar">
        <span>
          Logged in as <strong>{session.user.fullName}</strong> ({session.user.role})
        </span>
        <button type="button" onClick={handleLogout}>Log out</button>
      </div>

      <DonorRegistrationForm />

      {/* BBMS-F-011: only LAB_TECH may record vitals */}
      {session.user.role === 'LAB_TECH' && <DonationVitalsForm />}

      {UNIT_LABEL_ROLES.includes(session.user.role) && <UnitLabelLookup />}
    </main>
  );
}

export default App;
