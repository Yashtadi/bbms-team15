import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DonorPortalDashboard from './DonorPortalDashboard';

describe('DonorPortalDashboard (client)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockPortalData = {
    donor: {
      id: 1,
      donorCode: 'D-000001',
      fullName: 'Ravi Kumar',
      dateOfBirth: '1995-04-12',
      gender: 'MALE',
      bloodGroup: 'O-',
      phone: '9000000001',
      maskedIdProof: 'ID-****01',
      eligibilityStatus: 'ELIGIBLE',
    },
    stats: {
      totalDonations: 2,
      totalVolumeMl: 900,
      livesSaved: 6,
      lastDonationDate: '2026-10-01T10:00:00.000Z',
      nextEligibleDate: '2026-12-30',
      isEligibleNow: false,
      daysUntilEligible: 54,
    },
    history: [
      {
        id: 1,
        collectedAt: '2026-10-01T10:00:00.000Z',
        volumeMl: 450,
        status: 'COMPLETED',
        vitals: { hemoglobin: 14.2, bloodPressure: '120/80', weightKg: 72 },
      },
      {
        id: 2,
        collectedAt: '2026-06-15T10:00:00.000Z',
        volumeMl: 450,
        status: 'COMPLETED',
        vitals: { hemoglobin: 13.9, bloodPressure: '118/78', weightKg: 71 },
      },
    ],
  };

  it('fetches and renders donor profile, stats, and donation history', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => mockPortalData,
    });

    render(<DonorPortalDashboard />);

    expect(screen.getByTestId('portal-loading')).toBeInTheDocument();

    expect(await screen.findByTestId('portal-donor-name')).toHaveTextContent('Welcome, Ravi Kumar');
    expect(screen.getByTestId('metric-donations')).toHaveTextContent('2');
    expect(screen.getByTestId('metric-volume')).toHaveTextContent('900 mL');
    expect(screen.getByTestId('metric-eligibility')).toHaveTextContent('In 54 Days');

    expect(screen.getByTestId('donor-card')).toBeInTheDocument();
    expect(screen.getAllByTestId('history-item').length).toBe(2);
  });

  it('allows opening and submitting the change password form', async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/donors/portal/me')) {
        return Promise.resolve({
          status: 200,
          json: async () => mockPortalData,
        });
      }
      if (url.includes('/api/auth/change-password')) {
        return Promise.resolve({
          status: 200,
          json: async () => ({ message: 'Password updated successfully' }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(<DonorPortalDashboard />);

    await screen.findByTestId('portal-donor-name');

    const toggleBtn = screen.getByTestId('toggle-change-password');
    await user.click(toggleBtn);

    expect(screen.getByTestId('change-password-form')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Current Password/i), '12041995');
    await user.type(screen.getByLabelText(/^New Password/i), 'SecurePass123');
    await user.type(screen.getByLabelText(/Confirm New Password/i), 'SecurePass123');

    await user.click(screen.getByTestId('submit-change-password'));

    expect(await screen.findByTestId('password-success')).toHaveTextContent('Password successfully updated');
  });
});
