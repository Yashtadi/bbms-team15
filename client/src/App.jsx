import { useState } from 'react';
import DonorRegistrationForm from './components/DonorRegistrationForm';
import LoginForm from './components/LoginForm';
import { getSession, clearSession } from './api';
import './components/DonorRegistrationForm.css';

function App() {
  const [session, setSession] = useState(getSession);

  const handleLogout = () => {
    clearSession();
    setSession(null);
  };

  return (
    <main>
      <h1>Blood Bank Management System</h1>
      <p>Team 15 · Sprint 2</p>

      {session ? (
        <>
          <div className="user-bar">
            <span>
              Logged in as <strong>{session.user.fullName}</strong> ({session.user.role})
            </span>
            <button type="button" onClick={handleLogout}>Log out</button>
          </div>
          <DonorRegistrationForm />
        </>
      ) : (
        <LoginForm onLogin={setSession} />
      )}
    </main>
  );
}

export default App;
