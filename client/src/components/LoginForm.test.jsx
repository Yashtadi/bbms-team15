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
    const session = { token: 'fake-token', user: { id: 3, fullName: 'Labtech 1', role: 'LAB_TECH' } };
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

  it('shows descriptive server error message when server returns 500', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ message: 'Server error during login. Please verify database connection and configuration.' }),
    });
    const onLogin = vi.fn();

    render(<LoginForm onLogin={onLogin} />);
    await user.type(screen.getByLabelText('Email'), 'labtech@bbms.test');
    await user.type(screen.getByLabelText('Password'), 'Password@123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error during login');
    expect(onLogin).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('bbms.session')).toBeNull();
  });

  it('allows logging in with permanent Donor ID without browser email validation error', async () => {
    const user = userEvent.setup();
    const donorSession = { token: 'donor-token', user: { id: 10, fullName: 'Ravi Kumar', role: 'DONOR' } };
    global.fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => donorSession });
    const onLogin = vi.fn();

    render(<LoginForm onLogin={onLogin} />);
    expect(screen.getByPlaceholderText('Email / Donor ID')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Email / Donor ID'), 'D-000131');
    await user.type(screen.getByLabelText('Password'), '01012000');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(donorSession));
  });

  it('shows connection error when backend server is unreachable', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    const onLogin = vi.fn();

    render(<LoginForm onLogin={onLogin} />);
    await user.type(screen.getByLabelText('Email'), 'labtech@bbms.test');
    await user.type(screen.getByLabelText('Password'), 'Password@123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect to server');
    expect(onLogin).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('bbms.session')).toBeNull();
  });

  it('requires authenticator enrollment and code before Admin receives a session', async () => {
    const user = userEvent.setup();
    const session = { token: 'admin-token', user: { id: 1, fullName: 'Asha Admin', role: 'ADMIN' } };
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ mfaSetupRequired: true, setupToken: 'setup-token' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/BBMS' }),
      })
      .mockResolvedValueOnce({ status: 200, json: async () => session });
    const onLogin = vi.fn();

    render(<LoginForm onLogin={onLogin} />);
    await user.type(screen.getByLabelText('Email'), 'admin@bbms.test');
    await user.type(screen.getByLabelText('Password'), 'Password@123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByTestId('mfa-setup-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    expect(await screen.findByTestId('mfa-qr-code')).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('bbms.session')).toBeNull();

    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(session));
    expect(JSON.parse(sessionStorage.getItem('bbms.session')).token).toBe('admin-token');
  });

  it('requires a valid authenticator challenge code for an enrolled Manager', async () => {
    const user = userEvent.setup();
    const session = { token: 'manager-token', user: { id: 2, fullName: 'Manoj Manager', role: 'MANAGER' } };
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ mfaRequired: true, challengeToken: 'challenge-token' }),
      })
      .mockResolvedValueOnce({ status: 200, json: async () => session });
    const onLogin = vi.fn();

    render(<LoginForm onLogin={onLogin} />);
    await user.type(screen.getByLabelText('Email'), 'manager@bbms.test');
    await user.type(screen.getByLabelText('Password'), 'Password@123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByLabelText('Authenticator code')).toBeInTheDocument();
    expect(sessionStorage.getItem('bbms.session')).toBeNull();

    await user.type(screen.getByLabelText('Authenticator code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(session));
  });

  it('allows navigating back to the sign-in form from the 2FA setup screen', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ mfaSetupRequired: true, setupToken: 'setup-token' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/BBMS' }),
      });
    const onLogin = vi.fn();

    render(<LoginForm onLogin={onLogin} />);
    await user.type(screen.getByLabelText('Email'), 'admin@bbms.test');
    await user.type(screen.getByLabelText('Password'), 'Password@123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByTestId('mfa-setup-secret')).toBeInTheDocument();
    expect(await screen.findByTestId('mfa-qr-code')).toBeInTheDocument();

    const backButton = screen.getByRole('button', { name: /back/i });
    expect(backButton).toBeInTheDocument();
    await user.click(backButton);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-setup-secret')).not.toBeInTheDocument();
  });
});
