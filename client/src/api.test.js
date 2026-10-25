import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch, saveSession } from './api';

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
});
