import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch, saveSession, login } from './api';

describe('TC-Sec-02: apiFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('sends the token in the Authorization header when logged in', async () => {
    global.fetch = vi.fn().mockResolvedValue({});
    saveSession({ token: 'abc', user: {} });

    await apiFetch('/api/donors', { method: 'POST' });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer abc');
  });

  it('sends no Authorization header when logged out', async () => {
    global.fetch = vi.fn().mockResolvedValue({});

    await apiFetch('/api/donors');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers).not.toHaveProperty('Authorization');
  });

  it('handles network failure in login gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(login('user@bbms.test', 'pass')).rejects.toThrow(
      'Unable to connect to server. Please ensure the backend is running on port 4000.'
    );
  });

  it('handles 500 server error in login with descriptive message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ message: 'Database connection failed' }),
    });

    await expect(login('user@bbms.test', 'pass')).rejects.toThrow(
      'Database connection failed'
    );
  });

  it('TC-Sec-01 (BBMS-SR-001): rejects plaintext HTTP URLs for remote traffic', () => {
    expect(() => apiFetch('http://remote-blood-bank.test/api/donors')).toThrow(
      'Insecure plaintext HTTP channel is not accepted. HTTPS / TLS 1.2+ is required (BBMS-SR-001).'
    );
  });

  it('TC-Sec-01 (BBMS-SR-001): allows secure HTTPS URLs and local relative endpoints', async () => {
    global.fetch = vi.fn().mockResolvedValue({});
    await expect(apiFetch('https://secure-blood-bank.test/api/donors')).resolves.toBeDefined();
    await expect(apiFetch('/api/donors')).resolves.toBeDefined();
  });
});
