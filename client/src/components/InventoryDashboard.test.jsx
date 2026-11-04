import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InventoryDashboard, { POLL_INTERVAL_MS } from './InventoryDashboard';
import { apiFetch } from '../api';

vi.mock('../api', () => ({ apiFetch: vi.fn() }));

const IN_TEN_DAYS = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
const IN_TWO_DAYS = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

function jsonResponse(status, data) {
  return { status, json: async () => data };
}

function summaryWith(stock) {
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      units: stock.reduce((sum, s) => sum + s.units, 0),
      volumeMl: stock.reduce((sum, s) => sum + s.volumeMl, 0),
      nextExpiry: stock.length ? IN_TWO_DAYS : null,
    },
    stock,
  };
}

const SEED_SUMMARY = summaryWith([
  { bloodGroup: 'A+', component: 'PRBC', units: 1, volumeMl: 220, nextExpiry: IN_TWO_DAYS },
  { bloodGroup: 'O-', component: 'PRBC', units: 2, volumeMl: 560, nextExpiry: IN_TEN_DAYS },
]);
const SEED_UNITS = [
  { id: 4, unit_code: 'U-2026-000004', blood_group: 'A+', component: 'PRBC', volume_ml: 220, expires_at: IN_TWO_DAYS },
  { id: 1, unit_code: 'U-2026-000001', blood_group: 'O-', component: 'PRBC', volume_ml: 280, expires_at: IN_TEN_DAYS },
];

// The fake server: tests change these to simulate stock changing between polls.
let server;

function cellFor(bloodGroup, columnIndex) {
  const row = screen.getByRole('rowheader', { name: bloodGroup }).closest('tr');
  return within(row).getAllByRole('cell')[columnIndex];
}

describe('TC-Inv-01 (BBMS-F-030) inventory dashboard', () => {
  beforeEach(() => {
    server = { summary: jsonResponse(200, SEED_SUMMARY), list: jsonResponse(200, { units: SEED_UNITS }) };
    apiFetch.mockImplementation(async (path) => {
      const route = path.startsWith('/api/inventory/summary') ? server.summary : server.list;
      if (route instanceof Error) throw route;
      return route;
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('polls often enough to show changes within the 5-second acceptance limit', () => {
    expect(POLL_INTERVAL_MS).toBeLessThan(5000);
  });

  it('shows totals, the blood group × component grid and the unit list', async () => {
    render(<InventoryDashboard />);

    expect(await screen.findByTestId('total-units')).toHaveTextContent('3');
    expect(screen.getByText('780 ml')).toBeInTheDocument();

    // Columns: Whole blood, PRBC, FFP, Platelets, Cryo, Total
    expect(cellFor('O-', 1)).toHaveTextContent('2');
    expect(cellFor('O-', 5)).toHaveTextContent('2');
    expect(cellFor('A+', 1)).toHaveTextContent('1');
    expect(cellFor('B+', 5)).toHaveTextContent('0');
    expect(cellFor('B+', 5)).toHaveClass('is-empty');

    const unitTable = screen.getByRole('table', { name: /Available units/ });
    const rows = within(unitTable).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('U-2026-000004');
    expect(rows[0]).toHaveTextContent('2 days left');
    expect(rows[1]).toHaveTextContent('U-2026-000001');
  });

  it('reflects a stock change on the next poll without reloading the page', async () => {
    render(<InventoryDashboard pollIntervalMs={50} />);
    expect(await screen.findByTestId('total-units')).toHaveTextContent('3');

    // A lab tech releases one more O- PRBC unit on the server
    server.summary = jsonResponse(200, summaryWith([
      { bloodGroup: 'A+', component: 'PRBC', units: 1, volumeMl: 220, nextExpiry: IN_TWO_DAYS },
      { bloodGroup: 'O-', component: 'PRBC', units: 3, volumeMl: 840, nextExpiry: IN_TEN_DAYS },
    ]));

    await waitFor(() => expect(screen.getByTestId('total-units')).toHaveTextContent('4'));
    expect(cellFor('O-', 1)).toHaveTextContent('3');
  });

  it('shows empty stock as zeros and a clear message (boundary)', async () => {
    server.summary = jsonResponse(200, summaryWith([]));
    server.list = jsonResponse(200, { units: [] });
    render(<InventoryDashboard />);

    expect(await screen.findByTestId('total-units')).toHaveTextContent('0');
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No available units match these filters.')).toBeInTheDocument();
  });

  it('sends blood group and component filters to the unit list, URL-encoded', async () => {
    render(<InventoryDashboard />);
    await screen.findByTestId('total-units');

    fireEvent.change(screen.getByLabelText('Blood group'), { target: { value: 'A+' } });
    fireEvent.change(screen.getByLabelText('Component'), { target: { value: 'PRBC' } });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/inventory?bloodGroup=A%2B&component=PRBC');
    });
  });

  it('shows the server message when the first load is refused', async () => {
    server.summary = jsonResponse(403, { message: 'You do not have permission to do this' });
    render(<InventoryDashboard />);

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to do this');
    expect(screen.queryByTestId('total-units')).not.toBeInTheDocument();
  });

  it('keeps the last data, warns, and recovers when a refresh fails', async () => {
    render(<InventoryDashboard pollIntervalMs={50} />);
    expect(await screen.findByTestId('total-units')).toHaveTextContent('3');

    server.summary = new Error('offline');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not refresh: Network error: unable to connect to the server.',
    );
    expect(screen.getByTestId('total-units')).toHaveTextContent('3');

    server.summary = jsonResponse(200, SEED_SUMMARY);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('stops polling when the dashboard is closed', async () => {
    const { unmount } = render(<InventoryDashboard pollIntervalMs={30} />);
    await screen.findByTestId('total-units');
    unmount();
    const callsAtUnmount = apiFetch.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(apiFetch.mock.calls.length).toBe(callsAtUnmount);
  });
});
