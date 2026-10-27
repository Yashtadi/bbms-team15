import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('TC-Don-02: shows the donation vitals form to LAB_TECH', () => {
    logInAs('LAB_TECH');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Donation Vitals' })).toBeInTheDocument();
  });

  it.each(['ADMIN', 'MANAGER', 'HOSPITAL', 'DONOR'])(
    'TC-Don-02: hides the donation vitals form from %s',
    (role) => {
      logInAs(role);
      render(<App />);

      expect(screen.queryByRole('heading', { name: 'Donation Vitals' })).not.toBeInTheDocument();
    },
  );

  it.each(['LAB_TECH', 'MANAGER', 'ADMIN'])('TC-Don-03: shows the blood unit label panel to %s', (role) => {
    logInAs(role);
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Blood Unit Label' })).toBeInTheDocument();
  });

  it.each(['HOSPITAL', 'DONOR'])('TC-Don-03: hides the blood unit label panel from %s', (role) => {
    logInAs(role);
    render(<App />);

    expect(screen.queryByRole('heading', { name: 'Blood Unit Label' })).not.toBeInTheDocument();
  });
});
