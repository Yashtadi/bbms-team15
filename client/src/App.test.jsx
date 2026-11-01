import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { saveSession } from './api';

function logInAs(role) {
  saveSession({ token: 'fake-token', user: { id: 3, fullName: 'Test User', role } });
}

describe('App', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('shows the page title', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Blood Bank Management System' }),
    ).toBeInTheDocument();
  });

  it('TC-Don-02: shows the donation vitals tab to LAB_TECH and displays form on click', async () => {
    const user = userEvent.setup();
    logInAs('LAB_TECH');
    render(<App />);

    const vitalsTab = screen.getByRole('tab', { name: /Donation Vitals/i });
    expect(vitalsTab).toBeInTheDocument();

    await user.click(vitalsTab);
    expect(screen.getByRole('heading', { name: 'Donation Vitals' })).toBeInTheDocument();
  });

  it.each(['ADMIN', 'MANAGER', 'HOSPITAL', 'DONOR'])(
    'TC-Don-02: hides the donation vitals tab from %s',
    (role) => {
      logInAs(role);
      render(<App />);

      expect(screen.queryByRole('tab', { name: /Donation Vitals/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Donation Vitals' })).not.toBeInTheDocument();
    },
  );

  it.each(['LAB_TECH', 'MANAGER', 'ADMIN'])(
    'TC-Don-03: shows the blood unit label tab to %s and displays panel on click',
    async (role) => {
      const user = userEvent.setup();
      logInAs(role);
      render(<App />);

      const unitsTab = screen.getByRole('tab', { name: /Unit Labels/i });
      expect(unitsTab).toBeInTheDocument();

      await user.click(unitsTab);
      expect(screen.getByRole('heading', { name: 'Blood Unit Label' })).toBeInTheDocument();
    },
  );

  it.each(['HOSPITAL', 'DONOR'])(
    'TC-Don-03: hides the blood unit label tab from %s',
    (role) => {
      logInAs(role);
      render(<App />);

      expect(screen.queryByRole('tab', { name: /Unit Labels/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Blood Unit Label' })).not.toBeInTheDocument();
    },
  );

  it('allows switching between tabs and renders active module', async () => {
    const user = userEvent.setup();
    logInAs('LAB_TECH');
    render(<App />);

    // Initial tab is Donors
    expect(screen.getByRole('heading', { name: 'Donor Registration' })).toBeInTheDocument();

    // Switch to Lab Screening
    const labTab = screen.getByRole('tab', { name: /Lab Screening/i });
    await user.click(labTab);
    expect(screen.getByRole('heading', { name: 'Lab Screening' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Donor Registration' })).not.toBeInTheDocument();

    // Switch back to Donors
    const donorsTab = screen.getByRole('tab', { name: /Donors/i });
    await user.click(donorsTab);
    expect(screen.getByRole('heading', { name: 'Donor Registration' })).toBeInTheDocument();
  });

  it('logs out and returns to the login screen on logout button click', async () => {
    const user = userEvent.setup();
    logInAs('LAB_TECH');
    render(<App />);

    const logoutBtn = screen.getByRole('button', { name: /Log out/i });
    await user.click(logoutBtn);

    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(sessionStorage.getItem('bbms.session')).toBeNull();
  });
});
