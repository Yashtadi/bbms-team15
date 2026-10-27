import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnitLabelLookup from './UnitLabelLookup';

const UNIT = {
  unitId: 'U-2026-000007',
  barcode: { format: 'CODE128', value: 'U-2026-000007' },
  bloodGroup: 'PENDING',
  component: 'WHOLE_BLOOD',
  volumeMl: 350,
  status: 'QUARANTINE',
  collectedAt: '2026-10-27T10:00:00.000Z',
  expiresAt: '2026-12-01T10:00:00.000Z',
  donationId: 4,
};

function mockResponse(status, body) {
  globalThis.fetch = vi.fn().mockResolvedValue({ status, json: async () => body });
  return globalThis.fetch;
}

// A barcode scanner types the code and presses Enter
async function scan(user, code) {
  await user.type(screen.getByLabelText(/Scan or enter unit ID/i), `${code}{Enter}`);
}

describe('TC-Don-03: UnitLabelLookup (client)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the matching unit record and its label when a code is scanned (AC 4)', async () => {
    const user = userEvent.setup();
    const fetchMock = mockResponse(200, UNIT);
    render(<UnitLabelLookup />);

    await scan(user, 'U-2026-000007');

    expect(await screen.findByTestId('unit-record')).toBeInTheDocument();
    expect(screen.getByTestId('record-status')).toHaveTextContent('QUARANTINE');
    expect(screen.getByTestId('label-unit-id')).toHaveTextContent('U-2026-000007');
    expect(screen.getByTestId('label-blood-group')).toHaveTextContent('PENDING');
    expect(screen.getByTestId('label-collected')).toHaveTextContent('27 Oct 2026');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/donations/units/U-2026-000007');
  });

  it('trims the scanned code and encodes it in the URL', async () => {
    const user = userEvent.setup();
    const fetchMock = mockResponse(404, { message: 'Blood unit not found' });
    render(<UnitLabelLookup />);

    await scan(user, '  u-2026-000007/x ');

    await screen.findByTestId('general-error');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/donations/units/u-2026-000007%2Fx');
  });

  it('prints the label from the browser (AC 3)', async () => {
    const user = userEvent.setup();
    mockResponse(200, UNIT);
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(<UnitLabelLookup />);

    await scan(user, 'U-2026-000007');
    await user.click(await screen.findByRole('button', { name: 'Print Label' }));

    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('does not show a print button before a unit is found', () => {
    render(<UnitLabelLookup />);

    expect(screen.queryByRole('button', { name: 'Print Label' })).not.toBeInTheDocument();
  });

  it('asks for a unit ID without calling the server', async () => {
    const user = userEvent.setup();
    const fetchMock = mockResponse(200, UNIT);
    render(<UnitLabelLookup />);

    await user.click(screen.getByRole('button', { name: 'Find Unit' }));

    expect(screen.getByTestId('error-unitCode')).toHaveTextContent('Unit ID is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows "not found" for an unknown unit', async () => {
    const user = userEvent.setup();
    mockResponse(404, { message: 'Blood unit not found' });
    render(<UnitLabelLookup />);

    await scan(user, 'u-2026-999999');

    expect(await screen.findByTestId('general-error')).toHaveTextContent('No blood unit found for U-2026-999999');
    expect(screen.queryByTestId('unit-label')).not.toBeInTheDocument();
  });

  it('shows the server field error for a malformed code', async () => {
    const user = userEvent.setup();
    mockResponse(400, { message: 'Validation failed', errors: { unitId: 'Unit ID must look like U-2026-000123' } });
    render(<UnitLabelLookup />);

    await scan(user, 'D-000001');

    expect(await screen.findByTestId('error-unitCode')).toHaveTextContent('Unit ID must look like U-2026-000123');
  });

  it('shows the server message for other errors', async () => {
    const user = userEvent.setup();
    mockResponse(403, { message: 'You do not have permission to do this' });
    render(<UnitLabelLookup />);

    await scan(user, 'U-2026-000007');

    expect(await screen.findByTestId('general-error')).toHaveTextContent('You do not have permission to do this');
  });

  it('shows a network error when the server is unreachable', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    render(<UnitLabelLookup />);

    await scan(user, 'U-2026-000007');

    expect(await screen.findByTestId('general-error')).toHaveTextContent('Network error');
  });
});
