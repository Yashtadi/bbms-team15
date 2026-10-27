import { useState } from 'react';
import DonorRegistrationForm from './components/DonorRegistrationForm';
import DonationVitalsForm from './components/DonationVitalsForm';
import LoginForm from './components/LoginForm';
import { getSession, clearSession } from './api';
import './components/DonorRegistrationForm.css';

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
    </main>
  );
}

export default App;
