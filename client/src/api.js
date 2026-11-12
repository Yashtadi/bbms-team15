// Shared helpers for calling the BBMS API.
// apiFetch() adds the login token to every request, so components never handle it themselves.

const SESSION_KEY = 'bbms.session';

export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function saveSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function apiFetch(path, options = {}) {
  // BBMS-SR-001: Enforce HTTPS / TLS 1.2+ for all client-server and integration traffic
  if (
    typeof path === 'string' &&
    path.startsWith('http://') &&
    !path.includes('localhost') &&
    !path.includes('127.0.0.1')
  ) {
    throw new Error('Insecure plaintext HTTP channel is not accepted. HTTPS / TLS 1.2+ is required (BBMS-SR-001).');
  }
  const session = getSession();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  return fetch(path, { ...options, headers });
}

async function postAuth(path, payload) {
  let response;
  try {
    response = await apiFetch(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Unable to connect to server. Please ensure the backend is running on port 4000.');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 500) {
      throw new Error(data?.message || 'Server error during login. Please verify database connection and configuration.');
    }
    throw new Error(data?.message || 'Authentication failed');
  }

  if (data?.token) saveSession(data);
  return data;
}

export function login(email, password) {
  return postAuth('/api/auth/login', { email, password });
}

export function beginMfaSetup(setupToken) {
  return postAuth('/api/auth/mfa/setup', { setupToken });
}

export function verifyMfaSetup(setupToken, code) {
  return postAuth('/api/auth/mfa/setup/verify', { setupToken, code });
}

export function verifyMfa(challengeToken, code) {
  return postAuth('/api/auth/mfa/verify', { challengeToken, code });
}
