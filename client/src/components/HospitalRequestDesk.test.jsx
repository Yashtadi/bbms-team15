import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HospitalRequestDesk from './HospitalRequestDesk';
import * as api from '../api';

describe('TC-Req-01: HospitalRequestDesk (client)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    api.saveSession({
      token: 'fake-jwt-token',
      user: {
        id: 5,
        email: 'hospital@bbms.test',
        fullName: 'City Hospital Desk',
        role: 'HOSPITAL',
        organisation: 'City General Hospital',
      },
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('renders hospital info header and request submission form', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requests: [] }),
    });

    render(<HospitalRequestDesk />);

    expect(screen.getByText('City General Hospital')).toBeInTheDocument();
    expect(screen.getByText(/Authenticated Personnel:/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Submit New Blood Request/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Active Requests/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Patient Legal Full Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Patient Blood Group/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Required Component/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Units Requested/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Blood Request/i })).toBeInTheDocument();
  });

  it('validates required inputs before making an API call', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(api, 'apiFetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requests: [] }),
    });

    render(<HospitalRequestDesk />);

    const submitBtn = screen.getByRole('button', { name: /Submit Blood Request/i });
    await user.click(submitBtn);

    expect(screen.getByText(/Patient legal name is required/i)).toBeInTheDocument();
    // Only the initial GET was called, no POST
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('submits a valid blood request and displays success alert with Request ID and PENDING badge', async () => {
    const user = userEvent.setup();

    // 1. Initial list fetch
    vi.spyOn(api, 'apiFetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ requests: [] }),
      })
      // 2. POST create
      .mockResolvedValueOnce({
        status: 201,
        ok: true,
        json: async () => ({
          id: 15,
          requestCode: 'R-000015',
          patientName: 'Sunita Mehra',
          patientBloodGroup: 'O-',
          component: 'PRBC',
          unitsRequested: 2,
          priority: 'URGENT',
          status: 'PENDING',
          requiredBy: null,
          createdAt: new Date().toISOString(),
          hospital: { id: 5, organisation: 'City General Hospital' },
        }),
      })
      // 3. Post-submission list refresh
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          requests: [
            {
              id: 15,
              requestCode: 'R-000015',
              patientName: 'Sunita Mehra',
              patientBloodGroup: 'O-',
              component: 'PRBC',
              unitsRequested: 2,
              priority: 'URGENT',
              status: 'PENDING',
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });

    render(<HospitalRequestDesk />);

    // Fill in form
    await user.type(screen.getByLabelText(/Patient Legal Full Name/i), 'Sunita Mehra');
    await user.selectOptions(screen.getByLabelText(/Patient Blood Group/i), 'O-');
    await user.selectOptions(screen.getByLabelText(/Required Component/i), 'PRBC');

    const unitsInput = screen.getByLabelText(/Units Requested/i);
    await user.clear(unitsInput);
    await user.type(unitsInput, '2');

    // Select Urgent Priority
    const urgentRadio = screen.getByRole('radio', { name: /Urgent/i });
    await user.click(urgentRadio);

    // Submit
    await user.click(screen.getByRole('button', { name: /Submit Blood Request/i }));

    // Verify success banner
    await waitFor(() => {
      expect(screen.getByTestId('request-success-alert')).toBeInTheDocument();
    });
    expect(screen.getByText('R-000015')).toBeInTheDocument();
    expect(screen.getByText(/Blood Request Successfully Submitted!/i)).toBeInTheDocument();
    expect(screen.getByText('PENDING')).toBeInTheDocument();
  });

  it('fetches and displays the active requests list when switching tabs', async () => {
    const user = userEvent.setup();
    const mockRequests = [
      {
        id: 1,
        requestCode: 'R-000001',
        patientName: 'Patient One',
        patientBloodGroup: 'A+',
        component: 'PRBC',
        unitsRequested: 1,
        priority: 'ROUTINE',
        status: 'PENDING',
        createdAt: '2026-11-01T10:00:00.000Z',
      },
      {
        id: 2,
        requestCode: 'R-000002',
        patientName: 'Patient Two',
        patientBloodGroup: 'O-',
        component: 'PRBC',
        unitsRequested: 1,
        priority: 'EMERGENCY',
        status: 'PENDING',
        createdAt: '2026-11-02T11:00:00.000Z',
      },
    ];

    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      ok: true,
      json: async () => ({ requests: mockRequests }),
    });

    render(<HospitalRequestDesk />);

    const listTab = screen.getByRole('tab', { name: /Active Requests/i });
    await user.click(listTab);

    expect(screen.getByTestId('request-row-R-000001')).toBeInTheDocument();
    expect(screen.getByTestId('request-row-R-000002')).toBeInTheDocument();
    expect(screen.getByText('Patient One')).toBeInTheDocument();
    expect(screen.getByText('Patient Two')).toBeInTheDocument();
    expect(screen.getByText('EMERGENCY')).toBeInTheDocument();
  });

  it('displays server validation errors if returned by API', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'apiFetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ requests: [] }),
      })
      .mockResolvedValueOnce({
        status: 400,
        ok: false,
        json: async () => ({
          message: 'Validation failed',
          errors: { patientName: 'Patient name must not exceed 100 characters' },
        }),
      });

    render(<HospitalRequestDesk />);

    await user.type(screen.getByLabelText(/Patient Legal Full Name/i), 'Valid Name');
    await user.click(screen.getByRole('button', { name: /Submit Blood Request/i }));

    await waitFor(() => {
      expect(screen.getByText(/Patient name must not exceed 100 characters/i)).toBeInTheDocument();
    });
  });
});
