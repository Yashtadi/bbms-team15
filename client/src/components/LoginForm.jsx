import { useState } from 'react';
import { beginMfaSetup, login, verifyMfa, verifyMfaSetup } from '../api';
import ThemeToggle from './ThemeToggle';
import './LoginForm.css';

export default function LoginForm({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mfaState, setMfaState] = useState(null);
  const [mfaCode, setMfaCode] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.mfaSetupRequired) {
        const setup = await beginMfaSetup(result.setupToken);
        setMfaState({ type: 'setup', token: result.setupToken, ...setup });
      } else if (result.mfaRequired) {
        setMfaState({ type: 'verify', token: result.challengeToken });
      } else {
        onLogin(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const session = mfaState.type === 'setup'
        ? await verifyMfaSetup(mfaState.token, mfaCode)
        : await verifyMfa(mfaState.token, mfaCode);
      onLogin(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-theme-toggle">
        <ThemeToggle />
      </div>

      <section className="login-card">
        <div className="login-icon">
          <DropIcon />
        </div>

        <h1 className="login-title">Blood Bank Management System</h1>
        <p className="login-subtitle">
          Sign in to manage donors, blood units and hospital requests.
        </p>

        {mfaState ? (
          <form onSubmit={handleMfaSubmit} noValidate>
            {mfaState.type === 'setup' ? (
              <div className="mfa-instructions">
                <p>Set up an authenticator app, then enter its 6-digit code to finish signing in.</p>
                <p>Enter this setup key in your authenticator app:</p>
                <code className="mfa-setup-key" data-testid="mfa-setup-secret">{mfaState.secret}</code>
              </div>
            ) : (
              <p className="mfa-instructions">Enter the 6-digit code from your authenticator app.</p>
            )}
            <div className="login-field">
              <label htmlFor="mfa-code">Authenticator code</label>
              <input
                id="mfa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>
            {error && <p className="login-error" role="alert">{error}</p>}
            <button type="submit" className="login-submit" disabled={isSubmitting || mfaCode.length !== 6}>
              {isSubmitting ? 'Verifying…' : 'Verify and sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="login-email" className="sr-only">Email</label>
              <span className="field-icon"><MailIcon /></span>
              <input
                id="login-email"
                type="text"
                placeholder="Email / Donor ID"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="login-password" className="sr-only">Password</label>
              <span className="field-icon"><LockIcon /></span>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeIcon /> : <EyeOffIcon />}
              </button>
            </div>

            {error && <p className="login-error" role="alert">{error}</p>}

            <button type="submit" className="login-submit" disabled={isSubmitting}>
              {isSubmitting ? 'Logging in…' : 'Log in'}
            </button>

            {import.meta.env.DEV && (
              <p className="login-hint">
                Demo: <code>collector@bbms.test</code> · <code>labtech@bbms.test</code> · <code>Password@123</code>
              </p>
            )}
          </form>
        )}
      </section>
    </main>
  );
}

// Small inline icons (no icon library needed)
function DropIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c-3.6 4.7-6.5 8.4-6.5 11.7a6.5 6.5 0 0 0 13 0c0-3.3-2.9-7-6.5-11.7z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.1 4.1" />
      <path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
