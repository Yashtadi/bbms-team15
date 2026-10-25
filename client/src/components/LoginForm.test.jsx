import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginForm from './LoginForm';

describe('TC-Sec-02: LoginForm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('logs in, saves the session and calls onLogin', async () => {
    const user = userEvent.setup();
    const session = { token: 'fake-token', user: { id: 3, fullName: 'Lata LabTech', role: 'LAB_TECH' } };
    global.fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => session });
    const onLogin = vi.fn();

    render(<LoginForm onLogin={onLogin} />);
    await user.type(screen.getByLabelText('Email'), 'labtech@bbms.test');
    await user.type(screen.getByLabelText('Password'), 'Password@123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(session));
    expect(JSON.parse(sessionStorage.getItem('bbms.session')).token).toBe('fake-token');
  });

  it('shows the server message and does not log in on wrong credentials', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      status: 401,
      json: async () => ({ message: 'Invalid email or password' }),
    });
    const onLogin = vi.fn();

    render(<LoginForm onLogin={onLogin} />);
    await user.type(screen.getByLabelText('Email'), 'labtech@bbms.test');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(onLogin).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('bbms.session')).toBeNull();
  });
});
