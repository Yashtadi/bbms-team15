import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LabWorkflow from './LabWorkflow';
import { apiFetch } from '../api';

vi.mock('../api', () => ({ apiFetch: vi.fn() }));

function jsonResponse(status, data) {
  return { status, json: async () => data };
}

describe('BBMS-F-020 to F-023 lab workflow UI', () => {
  afterEach(() => vi.clearAllMocks());

  it('lets lab technicians enter and verify ABO/Rh results and record TTI methods', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse(200, { notifications: [] }))
      .mockResolvedValueOnce(jsonResponse(201, { bloodGroup: 'AB-' }));
    render(<LabWorkflow canEnterResults />);

    await screen.findByText('No notifications.');
    fireEvent.change(screen.getByLabelText('Donation ID *'), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText('ABO group'), { target: { value: 'AB' } });
    fireEvent.change(screen.getByLabelText('Rh factor'), { target: { value: '-' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record blood group' }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/lab/donations/42/blood-group',
        { method: 'POST', body: JSON.stringify({ aboGroup: 'AB', rh: '-' }) },
      );
    });

    apiFetch.mockResolvedValueOnce(jsonResponse(200, {
      donationId: 42,
      bloodGroup: 'AB-',
      verificationStatus: 'VERIFIED',
    })).mockResolvedValueOnce(jsonResponse(201, { testType: 'HCV', result: 'NON_REACTIVE' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify blood group' }));
    await screen.findByText('Blood group AB- verified and locked.');

    fireEvent.change(screen.getByLabelText('Test'), { target: { value: 'HCV' } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'NAT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record TTI result' }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/lab/donations/42/tti-results',
        {
          method: 'POST',
          body: JSON.stringify({ testType: 'HCV', result: 'NON_REACTIVE', method: 'NAT' }),
        },
      );
    });
  });

  it('shows confidential notifications to staff but hides result-entry forms from managers', async () => {
    apiFetch.mockResolvedValue(jsonResponse(200, {
      notifications: [{
        id: 5,
        message: 'Confidential follow-up is required for blood unit U-2026-000123.',
        created_at: '2026-10-27T12:00:00.000Z',
      }],
    }));
    render(<LabWorkflow canEnterResults={false} />);

    expect(screen.queryByLabelText('Donation ID *')).not.toBeInTheDocument();
    expect(await screen.findByText(/Confidential follow-up is required/)).toBeInTheDocument();
  });

  it('shows mismatched verification as a flagged error', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse(200, { notifications: [] }))
      .mockResolvedValueOnce(jsonResponse(409, {
        message: 'Verification did not match',
        flagged: true,
      }));
    render(<LabWorkflow canEnterResults />);

    await screen.findByText('No notifications.');
    fireEvent.change(screen.getByLabelText('Donation ID *'), { target: { value: '44' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify blood group' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This mismatch has been flagged.');
  });
});
