import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollectionDeskWizard from './CollectionDeskWizard';

describe('CollectionDeskWizard (client)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Step 1 with Register New Donor form by default', () => {
    render(<CollectionDeskWizard />);

    expect(screen.getByRole('heading', { level: 2, name: /Blood Collection Desk/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Register New Donor/i })).toHaveClass('active');
    expect(screen.getByLabelText(/Full Legal Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Date of Birth/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Phone Number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Government ID Proof/i)).toBeInTheDocument();
  });

  it('allows toggling between Register New Donor and Search Existing Donor', async () => {
    const user = userEvent.setup();
    render(<CollectionDeskWizard />);

    const searchModeBtn = screen.getByRole('button', { name: /Search Existing Donor/i });
    await user.click(searchModeBtn);

    expect(searchModeBtn).toHaveClass('active');
    expect(screen.getByPlaceholderText(/Enter Donor ID/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lookup/i })).toBeInTheDocument();
  });

  it('registers a new donor and advances to Step 2', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 201,
      json: async () => ({ donorId: 'D-000008', message: 'Donor registered successfully' }),
    });

    render(<CollectionDeskWizard />);

    await user.type(screen.getByLabelText(/Full Legal Name/i), 'Pooja Hegde');
    await user.type(screen.getByLabelText(/Date of Birth/i), '1995-04-12');
    await user.type(screen.getByLabelText(/Phone Number/i), '9888877777');
    await user.type(screen.getByLabelText(/Government ID Proof/i), 'AADHAAR-9999-8888');

    await user.click(screen.getByRole('button', { name: /Register & Proceed to Donation/i }));

    expect(await screen.findByRole('heading', { level: 2, name: /Donation Session & Pre-Vitals/i })).toBeInTheDocument();
    expect(screen.getByText('Pooja Hegde')).toBeInTheDocument();
    expect(screen.getByText('(D-000008)')).toBeInTheDocument();
  });

  it('looks up an existing donor and advances to Step 2', async () => {
    const user = userEvent.setup();
    const donorMock = {
      donorId: 1,
      donorCode: 'D-000001',
      fullName: 'Rahul Sharma',
      gender: 'MALE',
      phone: '9000000001',
      bloodGroup: 'O_POS',
      eligibilityStatus: 'ELIGIBLE',
      consentGiven: true,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => donorMock,
    });

    render(<CollectionDeskWizard />);

    // Switch to search mode
    await user.click(screen.getByRole('button', { name: /Search Existing Donor/i }));

    // Type query and lookup
    await user.type(screen.getByPlaceholderText(/Enter Donor ID/i), 'D-000001');
    await user.click(screen.getByRole('button', { name: /Lookup/i }));

    // Donor card displayed
    expect(await screen.findByText('Rahul Sharma')).toBeInTheDocument();
    expect(screen.getByText('D-000001')).toBeInTheDocument();
    expect(screen.getByText('ELIGIBLE')).toBeInTheDocument();

    // Click to start collection session
    await user.click(screen.getByRole('button', { name: /Start Blood Collection Session/i }));

    // Should now be on Step 2
    expect(screen.getByRole('heading', { level: 2, name: /Donation Session & Pre-Vitals/i })).toBeInTheDocument();
    expect(screen.getByText('Rahul Sharma')).toBeInTheDocument();
  });

  it('shows error when donor search returns 404', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      json: async () => ({ message: 'Donor not found' }),
    });

    render(<CollectionDeskWizard />);
    await user.click(screen.getByRole('button', { name: /Search Existing Donor/i }));
    await user.type(screen.getByPlaceholderText(/Enter Donor ID/i), 'D-999999');
    await user.click(screen.getByRole('button', { name: /Lookup/i }));

    expect(await screen.findByText(/No donor found matching "D-999999"/i)).toBeInTheDocument();
  });

  it('prevents starting collection if donor is DEFERRED', async () => {
    const user = userEvent.setup();
    const deferredDonor = {
      donorId: 2,
      donorCode: 'D-000002',
      fullName: 'Ananya Roy',
      gender: 'FEMALE',
      phone: '9000000002',
      bloodGroup: 'B_POS',
      eligibilityStatus: 'DEFERRED',
      deferralReason: 'Recent dental surgery',
      consentGiven: true,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => deferredDonor,
    });

    render(<CollectionDeskWizard />);
    await user.click(screen.getByRole('button', { name: /Search Existing Donor/i }));
    await user.type(screen.getByPlaceholderText(/Enter Donor ID/i), 'D-000002');
    await user.click(screen.getByRole('button', { name: /Lookup/i }));

    expect(await screen.findByText('DEFERRED')).toBeInTheDocument();
    expect(screen.getByText(/Recent dental surgery/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start Blood Collection Session/i })).not.toBeInTheDocument();
  });

  it('completes the entire 3-step workflow: check-in -> draw/vitals -> barcode label', async () => {
    const user = userEvent.setup();

    const donorMock = {
      donorId: 3,
      donorCode: 'D-000003',
      fullName: 'Vikram Mehta',
      gender: 'MALE',
      phone: '9000000003',
      bloodGroup: 'AB_POS',
      eligibilityStatus: 'ELIGIBLE',
      consentGiven: true,
    };

    const sessionResponse = {
      donationId: 101,
      donorId: 3,
      donationType: 'WHOLE_BLOOD',
      status: 'COLLECTED',
      collectedAt: '2026-11-02T10:00:00.000Z',
      unit: {
        unitId: 'U-2026-000101',
        component: 'WHOLE_BLOOD',
        volumeMl: 450,
        status: 'QUARANTINE',
        expiresAt: '2026-12-07T10:00:00.000Z',
      },
    };

    const vitalsResponse = {
      donationId: 101,
      phase: 'PRE',
      vitals: {
        bpSystolic: 120,
        bpDiastolic: 80,
        pulseBpm: 72,
        hemoglobinGDl: 13.5,
      },
      warnings: [],
    };

    const unitResponse = {
      unitId: 'U-2026-000101',
      donationId: 101,
      barcode: { format: 'CODE128', value: 'U-2026-000101' },
      bloodGroup: 'PENDING',
      component: 'WHOLE_BLOOD',
      volumeMl: 450,
      status: 'QUARANTINE',
      collectedAt: '2026-11-02T10:00:00.000Z',
      expiresAt: '2026-12-07T10:00:00.000Z',
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('/api/donors/D-000003')) {
        return { status: 200, json: async () => donorMock };
      }
      if (url === '/api/donations' && opts?.method === 'POST') {
        return { status: 201, json: async () => sessionResponse };
      }
      if (url.includes('/vitals/pre') && opts?.method === 'PUT') {
        return { status: 200, json: async () => vitalsResponse };
      }
      if (url.includes('/api/donations/units/U-2026-000101')) {
        return { status: 200, json: async () => unitResponse };
      }
      return { status: 404, json: async () => ({}) };
    });

    render(<CollectionDeskWizard />);

    // Step 1: Look up Vikram
    await user.click(screen.getByRole('button', { name: /Search Existing Donor/i }));
    await user.type(screen.getByPlaceholderText(/Enter Donor ID/i), 'D-000003');
    await user.click(screen.getByRole('button', { name: /Lookup/i }));

    expect(await screen.findByText('Vikram Mehta')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Start Blood Collection Session/i }));

    // Step 2: Draw & Vitals
    expect(screen.getByRole('heading', { level: 2, name: /Donation Session & Pre-Vitals/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Systolic BP/i)).toHaveValue(120);
    expect(screen.getByLabelText(/Diastolic BP/i)).toHaveValue(80);

    // Complete draw
    await user.click(screen.getByRole('button', { name: /Complete Draw & Generate Barcode Label/i }));

    // Step 3: Barcode Label Screen
    expect(await screen.findByRole('heading', { level: 3, name: /Collection Complete & Blood Unit Allocated!/i })).toBeInTheDocument();
    expect(screen.getByText('#101')).toBeInTheDocument();
    expect(screen.getByText('Vikram Mehta')).toBeInTheDocument();
    expect(screen.getByText('STATE: QUARANTINE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print Unit Barcode Sticker/i })).toBeInTheDocument();

    // Check reset button returns to Step 1
    await user.click(screen.getByRole('button', { name: /Check-in Next Donor/i }));
    expect(screen.getByRole('heading', { level: 2, name: /Blood Collection Desk/i })).toBeInTheDocument();
  });
});
