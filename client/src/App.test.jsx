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
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('shows the page title', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Blood Bank Management System' }),
    ).toBeInTheDocument();
  });

  it('TC-Col-01: shows collection desk tab to HOSPITAL (frontline collector) and lands on it by default', () => {
    logInAs('HOSPITAL');
    render(<App />);

    const collectionTab = screen.getByRole('tab', { name: /Collection Desk/i });
    expect(collectionTab).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Blood Collection Desk' })).toBeInTheDocument();
  });

  it.each(['LAB_TECH', 'MANAGER', 'DONOR'])(
    'TC-Col-01: hides collection desk tab from central lab / non-collector role %s',
    (role) => {
      logInAs(role);
      render(<App />);

      expect(screen.queryByRole('tab', { name: /Collection Desk/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2, name: 'Blood Collection Desk' })).not.toBeInTheDocument();
    },
  );

  it('lands LAB_TECH on Lab Screening by default', () => {
    logInAs('LAB_TECH');
    render(<App />);

    expect(screen.getByRole('tab', { name: /Lab Screening/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lab Screening' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Collection Desk/i })).not.toBeInTheDocument();
  });

  it('lands MANAGER on the inventory dashboard by default without collection desk access', () => {
    logInAs('MANAGER');
    render(<App />);

    expect(screen.queryByRole('tab', { name: /Collection Desk/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Inventory/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inventory Dashboard' })).toBeInTheDocument();
  });

  it('hides the collection desk and inventory tabs from DONOR, showing My Donor Card instead', () => {
    logInAs('DONOR');
    render(<App />);

    expect(screen.queryByRole('tab', { name: /Collection Desk/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Inventory/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /My Donor Card/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Donor Registration' })).toBeInTheDocument();
  });

  it.each(['LAB_TECH', 'ADMIN', 'MANAGER', 'HOSPITAL', 'DONOR'])(
    'does not show a disconnected standalone donation vitals tab to %s (vitals unified in Collection Desk)',
    (role) => {
      logInAs(role);
      render(<App />);

      expect(screen.queryByRole('tab', { name: /Donation Vitals/i })).not.toBeInTheDocument();
    },
  );

  it.each(['HOSPITAL', 'LAB_TECH', 'MANAGER', 'ADMIN'])(
    'TC-Don-03: shows the blood label tool tab to %s and displays panel on click',
    async (role) => {
      const user = userEvent.setup();
      logInAs(role);
      render(<App />);

      const unitsTab = screen.getByRole('tab', { name: /Blood Label Tool/i });
      expect(unitsTab).toBeInTheDocument();

      await user.click(unitsTab);
      expect(screen.getByRole('heading', { name: 'Blood Unit Label' })).toBeInTheDocument();
    },
  );

  it('TC-Don-03: hides the blood label tool tab from DONOR', () => {
    logInAs('DONOR');
    render(<App />);

    expect(screen.queryByRole('tab', { name: /Blood Label Tool/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Blood Unit Label' })).not.toBeInTheDocument();
  });

  it.each(['LAB_TECH', 'MANAGER', 'ADMIN'])(
    'TC-Inv-01: shows the inventory tab to %s and displays the dashboard on click',
    async (role) => {
      const user = userEvent.setup();
      logInAs(role);
      render(<App />);

      await user.click(screen.getByRole('tab', { name: /Inventory/i }));
      expect(screen.getByRole('heading', { name: 'Inventory Dashboard' })).toBeInTheDocument();
    },
  );

  it.each(['HOSPITAL', 'DONOR'])(
    'TC-Inv-01: hides the inventory tab from %s',
    (role) => {
      logInAs(role);
      render(<App />);

      expect(screen.queryByRole('tab', { name: /Inventory/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Inventory Dashboard' })).not.toBeInTheDocument();
    },
  );

  it('allows switching between tabs and renders active module', async () => {
    const user = userEvent.setup();
    logInAs('LAB_TECH');
    render(<App />);

    // Initial tab is Lab Screening for LAB_TECH
    expect(screen.getByRole('heading', { name: 'Lab Screening' })).toBeInTheDocument();

    // Switch to Inventory
    const invTab = screen.getByRole('tab', { name: /Inventory/i });
    await user.click(invTab);
    expect(screen.getByRole('heading', { name: 'Inventory Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lab Screening' })).not.toBeInTheDocument();

    // Switch back to Lab Screening
    const labTab = screen.getByRole('tab', { name: /Lab Screening/i });
    await user.click(labTab);
    expect(screen.getByRole('heading', { name: 'Lab Screening' })).toBeInTheDocument();
  });

  it('toggles theme between light and dark and persists to localStorage', async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    const user = userEvent.setup();
    logInAs('LAB_TECH');
    render(<App />);

    const themeBtn = screen.getByRole('button', { name: /switch to dark mode/i });
    expect(themeBtn).toBeInTheDocument();

    await user.click(themeBtn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('bbms_theme')).toBe('dark');

    // Click again to switch to light mode
    const lightBtn = screen.getByRole('button', { name: /switch to light mode/i });
    await user.click(lightBtn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('bbms_theme')).toBe('light');
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
