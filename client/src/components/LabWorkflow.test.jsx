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
    apiFetch.mockImplementation(async (url) => {
      if (url.includes('/notifications')) return jsonResponse(200, { notifications: [] });
      if (url.includes('/queue')) return jsonResponse(200, { queue: [] });
      if (url.includes('/blood-group/verify')) {
        return jsonResponse(200, { donationId: 42, bloodGroup: 'AB-', verificationStatus: 'VERIFIED' });
      }
      if (url.includes('/blood-group')) {
        return jsonResponse(201, { bloodGroup: 'AB-' });
      }
      if (url.includes('/tti-results')) {
        return jsonResponse(201, { testType: 'HCV', result: 'NON_REACTIVE' });
      }
      return jsonResponse(200, {});
    });

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
    apiFetch.mockImplementation(async (url) => {
      if (url.includes('/notifications')) {
        return jsonResponse(200, {
          notifications: [{
            id: 5,
            message: 'Confidential follow-up is required for blood unit U-2026-000123.',
            created_at: '2026-10-27T12:00:00.000Z',
          }],
        });
      }
      if (url.includes('/queue')) return jsonResponse(200, { queue: [] });
      return jsonResponse(200, {});
    });

    render(<LabWorkflow canEnterResults={false} />);

    expect(screen.queryByLabelText('Donation ID *')).not.toBeInTheDocument();
    expect(await screen.findByText(/Confidential follow-up is required/)).toBeInTheDocument();
  });

  it('shows mismatched verification as a flagged error', async () => {
    apiFetch.mockImplementation(async (url) => {
      if (url.includes('/notifications')) return jsonResponse(200, { notifications: [] });
      if (url.includes('/queue')) return jsonResponse(200, { queue: [] });
      if (url.includes('/blood-group/verify')) {
        return jsonResponse(409, {
          message: 'Verification did not match',
          flagged: true,
        });
      }
      return jsonResponse(200, {});
    });

    render(<LabWorkflow canEnterResults />);

    await screen.findByText('No notifications.');
    fireEvent.change(screen.getByLabelText('Donation ID *'), { target: { value: '44' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify blood group' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This mismatch has been flagged.');
  });

  it('renders newly donated blood in the testing queue and populates testing fields on click', async () => {
    const fakeQueueItem = {
      donationId: 101,
      unitId: 501,
      unitCode: 'U-2026-000501',
      donorName: 'Aarav Patel',
      donorCode: 'D-000101',
      component: 'WHOLE_BLOOD',
      volumeMl: 450,
      collectedAt: new Date().toISOString(),
      unitStatus: 'QUARANTINE',
      abo: { result: 'O+', verificationStatus: 'PENDING' },
      tti: {
        results: [{ testType: 'HIV', result: 'NON_REACTIVE', method: 'ELISA' }],
        completedCount: 1,
        remaining: ['HBV', 'HCV', 'SYPHILIS', 'MALARIA'],
      },
    };

    apiFetch.mockImplementation(async (url) => {
      if (url.includes('/notifications')) return jsonResponse(200, { notifications: [] });
      if (url.includes('/queue')) return jsonResponse(200, { queue: [fakeQueueItem] });
      return jsonResponse(200, {});
    });

    render(<LabWorkflow canEnterResults />);

    expect(await screen.findByText('Newly Donated Blood — Testing Queue')).toBeInTheDocument();
    expect(screen.getByText('Aarav Patel')).toBeInTheDocument();
    expect(screen.getByText(/U-2026-000501/)).toBeInTheDocument();
    expect(screen.getByText(/1 Unit Awaiting Screening/i)).toBeInTheDocument();

    // Click "Select for Testing"
    fireEvent.click(screen.getByRole('button', { name: /Select for Testing/i }));

    // Sets donationId and shows active banner
    expect(screen.getByLabelText('Donation ID *')).toHaveValue('101');
    expect(screen.getByText(/Active Unit: U-2026-000501/)).toBeInTheDocument();
    // Fill-in-the-blank form is now visible
    expect(screen.getByLabelText('ABO group')).toBeInTheDocument();
  });

  it('keeps search bar visible by default and only shows fill-in-the-blank options when ticket is pressed or ID entered', async () => {
    apiFetch.mockImplementation(async (url) => {
      if (url.includes('/notifications')) return jsonResponse(200, { notifications: [] });
      if (url.includes('/queue')) return jsonResponse(200, { queue: [] });
      return jsonResponse(200, {});
    });

    render(<LabWorkflow canEnterResults />);

    // Search bar is visible by default
    expect(screen.getByLabelText('Donation ID *')).toBeInTheDocument();
    // Fill-in-the-blank options (ABO group, TTI screening) are hidden by default
    expect(screen.queryByLabelText('ABO group')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Test')).not.toBeInTheDocument();
    expect(screen.getByText(/Select a blood collection ticket from the queue above/i)).toBeInTheDocument();

    // Type a donation ID into the search bar
    fireEvent.change(screen.getByLabelText('Donation ID *'), { target: { value: '7' } });

    // Fill-in-the-blank options now appear
    expect(screen.getByLabelText('ABO group')).toBeInTheDocument();
    expect(screen.getByLabelText('Test')).toBeInTheDocument();

    // Clicking Clear hides the options again
    fireEvent.click(screen.getByRole('button', { name: /Clear/i }));
    expect(screen.queryByLabelText('ABO group')).not.toBeInTheDocument();
  });

  it('paginates the queue to 6 cards per page in strict First In First Out (FIFO) order', async () => {
    // 8 donations with different collection times
    const queueItems = Array.from({ length: 8 }, (_, idx) => {
      const num = idx + 1;
      return {
        donationId: num,
        unitId: 500 + num,
        unitCode: `U-2026-00050${num}`,
        donorName: `Donor ${num}`,
        donorCode: `D-00010${num}`,
        component: 'WHOLE_BLOOD',
        volumeMl: 450,
        // Day 1 to Day 8
        collectedAt: new Date(`2026-10-0${num}T10:00:00Z`).toISOString(),
        unitStatus: 'QUARANTINE',
        abo: null,
        tti: { results: [], completedCount: 0, remaining: ['HIV', 'HBV', 'HCV', 'SYPHILIS', 'MALARIA'], hasReactive: false },
      };
    });

    // Provide them in reverse order to test FIFO sorting
    const shuffled = [...queueItems].reverse();

    apiFetch.mockImplementation(async (url) => {
      if (url.includes('/notifications')) return jsonResponse(200, { notifications: [] });
      if (url.includes('/queue')) return jsonResponse(200, { queue: shuffled });
      return jsonResponse(200, {});
    });

    render(<LabWorkflow canEnterResults />);

    expect(await screen.findByText(/8 Units Awaiting Screening/i)).toBeInTheDocument();

    // Page 1 displays up to 6 cards (First In: Donors 1 to 6)
    expect(screen.getByText('Donor 1')).toBeInTheDocument();
    expect(screen.getByText('Donor 6')).toBeInTheDocument();
    // Donors 7 and 8 should NOT be on Page 1
    expect(screen.queryByText('Donor 7')).not.toBeInTheDocument();
    expect(screen.queryByText('Donor 8')).not.toBeInTheDocument();

    // Pagination info
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeEnabled();

    // Click Next to go to Page 2
    fireEvent.click(nextBtn);
    expect(screen.getByText(/Page 2 of 2/i)).toBeInTheDocument();
    expect(screen.getByText('Donor 7')).toBeInTheDocument();
    expect(screen.getByText('Donor 8')).toBeInTheDocument();
    expect(screen.queryByText('Donor 1')).not.toBeInTheDocument();
    expect(nextBtn).toBeDisabled();
    expect(prevBtn).toBeEnabled();

    // Click Previous to return to Page 1
    fireEvent.click(prevBtn);
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText('Donor 1')).toBeInTheDocument();
  });

  it('shows empty queue message when all units have been processed', async () => {
    apiFetch.mockImplementation(async (url) => {
      if (url.includes('/notifications')) return jsonResponse(200, { notifications: [] });
      if (url.includes('/queue')) return jsonResponse(200, { queue: [] });
      return jsonResponse(200, {});
    });

    render(<LabWorkflow canEnterResults />);

    expect(await screen.findByText(/All blood collections have been tested!/)).toBeInTheDocument();
  });
});
