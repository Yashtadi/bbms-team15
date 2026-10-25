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
  const session = getSession();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  return fetch(path, { ...options, headers });
}

export async function login(email, password) {
  const response = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();

  if (response.status !== 200) {
    throw new Error(data.message || 'Login failed');
  }

  saveSession(data);
  return data;
}
