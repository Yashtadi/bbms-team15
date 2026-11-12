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

const SEED_ALERTS = {
  thresholdDays: 3,
  alertCount: 1,
  alerts: [
    {
      id: 4,
      unitCode: 'U-2026-000004',
      bloodGroup: 'A+',
      component: 'PRBC',
      volumeMl: 220,
      status: 'AVAILABLE',
      expiresAt: IN_TWO_DAYS,
      hoursRemaining: 48,
      daysRemaining: 2,
      urgency: 'WARNING',
    },
  ],
};

const SEED_LOW_STOCK_ALERTS = {
  threshold: 3,
  alertCount: 2,
  alerts: [
    {
      bloodGroup: 'B+',
      availableUnits: 0,
      volumeMl: 0,
      threshold: 3,
      deficit: 3,
      urgency: 'OUT_OF_STOCK',
      message: 'Critical shortage: Blood group B+ is OUT OF STOCK (0 units available, safety threshold is 3)',
    },
    {
      bloodGroup: 'O-',
      availableUnits: 2,
      volumeMl: 560,
      threshold: 3,
      deficit: 1,
      urgency: 'LOW_STOCK',
      message: 'Low stock alert: Blood group O- has 2 units available (below safety threshold of 3)',
    },
  ],
  stockByGroup: [
    { bloodGroup: 'B+', availableUnits: 0, volumeMl: 0, threshold: 3, isLow: true, deficit: 3 },
    { bloodGroup: 'O-', availableUnits: 2, volumeMl: 560, threshold: 3, isLow: true, deficit: 1 },
    { bloodGroup: 'A+', availableUnits: 3, volumeMl: 660, threshold: 3, isLow: false, deficit: 0 },
  ],
};

describe('TC-Inv-01 (BBMS-F-030) inventory dashboard', () => {
  beforeEach(() => {
    server = {
      summary: jsonResponse(200, SEED_SUMMARY),
      list: jsonResponse(200, { units: SEED_UNITS }),
      alerts: jsonResponse(200, SEED_ALERTS),
      lowStockAlerts: jsonResponse(200, SEED_LOW_STOCK_ALERTS),
      fefo: jsonResponse(200, {
        patientBloodGroup: 'A+',
        component: 'PRBC',
        suggestedUnits: [
          {
            rank: 1,
            unitCode: 'U-2026-000004',
            bloodGroup: 'A+',
            component: 'PRBC',
            volumeMl: 220,
            expiresAt: IN_TWO_DAYS,
            daysRemaining: 2,
          },
        ],
      }),
    };
    apiFetch.mockImplementation(async (path) => {
      let route;
      if (path.startsWith('/api/inventory/summary')) {
        route = server.summary;
      } else if (path.startsWith('/api/inventory/alerts/low-stock') || path.startsWith('/api/inventory/low-stock-alerts')) {
        route = server.lowStockAlerts;
      } else if (path.startsWith('/api/inventory/alerts') || path.startsWith('/api/inventory/expiry-alerts')) {
        route = server.alerts;
      } else if (path.startsWith('/api/inventory/fefo')) {
        route = server.fefo;
      } else {
        route = server.list;
      }
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

describe('TC-Inv-03 (BBMS-F-032) expiry alerts on manager dashboard', () => {
  beforeEach(() => {
    server = {
      summary: jsonResponse(200, SEED_SUMMARY),
      list: jsonResponse(200, { units: SEED_UNITS }),
      alerts: jsonResponse(200, SEED_ALERTS),
      lowStockAlerts: jsonResponse(200, SEED_LOW_STOCK_ALERTS),
    };
    apiFetch.mockImplementation(async (path) => {
      let route;
      if (path.startsWith('/api/inventory/summary')) {
        route = server.summary;
      } else if (path.startsWith('/api/inventory/alerts/low-stock') || path.startsWith('/api/inventory/low-stock-alerts')) {
        route = server.lowStockAlerts;
      } else if (path.startsWith('/api/inventory/alerts') || path.startsWith('/api/inventory/expiry-alerts')) {
        route = server.alerts;
      } else {
        route = server.list;
      }
      if (route instanceof Error) throw route;
      return route;
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('renders the expiry alerts card with default 3-day threshold and units nearing expiry', async () => {
    render(<InventoryDashboard />);

    expect(await screen.findByTestId('expiry-alerts-card')).toBeInTheDocument();
    expect(screen.getByTestId('stat-expiring-units')).toHaveTextContent('1');

    const alertTable = screen.getByTestId('expiry-alerts-table');
    expect(alertTable).toBeInTheDocument();
    expect(within(alertTable).getByText('U-2026-000004')).toBeInTheDocument();
    expect(within(alertTable).getByText('2 days left (WARNING)')).toBeInTheDocument();
  });

  it('allows changing the alert threshold and re-fetches alerts with the new threshold', async () => {
    render(<InventoryDashboard pollIntervalMs={50} />);

    const select = await screen.findByTestId('expiry-threshold-select');
    expect(select).toHaveValue('3');

    // Change threshold to 1 day (24 hours) where no units are nearing expiry
    server.alerts = jsonResponse(200, {
      thresholdDays: 1,
      alertCount: 0,
      alerts: [],
    });

    fireEvent.change(select, { target: { value: '1' } });

    await waitFor(() => {
      expect(screen.getByTestId('stat-expiring-units')).toHaveTextContent('0');
    });
    expect(screen.getByTestId('no-expiry-alerts')).toHaveTextContent('No units nearing expiry within 1 day');
  });

  it('displays a reassurance message when no units are nearing expiry', async () => {
    server.alerts = jsonResponse(200, {
      thresholdDays: 3,
      alertCount: 0,
      alerts: [],
    });

    render(<InventoryDashboard />);

    expect(await screen.findByTestId('no-expiry-alerts')).toHaveTextContent(
      'No units nearing expiry within 3 days. Safe shelf life.'
    );
    expect(screen.queryByTestId('expiry-alerts-table')).not.toBeInTheDocument();
  });
});

describe('TC-Inv-04 (BBMS-F-033) FEFO allocation on manager dashboard', () => {
  beforeEach(() => {
    server = {
      summary: jsonResponse(200, SEED_SUMMARY),
      list: jsonResponse(200, { units: SEED_UNITS }),
      alerts: jsonResponse(200, SEED_ALERTS),
      lowStockAlerts: jsonResponse(200, SEED_LOW_STOCK_ALERTS),
      fefo: jsonResponse(200, {
        patientBloodGroup: 'A+',
        component: 'PRBC',
        suggestedUnits: [
          {
            rank: 1,
            unitCode: 'U-2026-000004',
            bloodGroup: 'A+',
            component: 'PRBC',
            volumeMl: 220,
            expiresAt: IN_TWO_DAYS,
            daysRemaining: 2,
          },
        ],
      }),
    };
    apiFetch.mockImplementation(async (path) => {
      let route;
      if (path.startsWith('/api/inventory/summary')) {
        route = server.summary;
      } else if (path.startsWith('/api/inventory/alerts/low-stock') || path.startsWith('/api/inventory/low-stock-alerts')) {
        route = server.lowStockAlerts;
      } else if (path.startsWith('/api/inventory/alerts') || path.startsWith('/api/inventory/expiry-alerts')) {
        route = server.alerts;
      } else if (path.startsWith('/api/inventory/fefo')) {
        route = server.fefo;
      } else {
        route = server.list;
      }
      if (route instanceof Error) throw route;
      return route;
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('renders the FEFO allocation finder card and finds soonest-to-expire compatible units', async () => {
    render(<InventoryDashboard />);

    expect(await screen.findByTestId('fefo-finder-card')).toBeInTheDocument();
    expect(screen.getByTestId('fefo-patient-group-select')).toHaveValue('A+');
    expect(screen.getByTestId('fefo-component-select')).toHaveValue('PRBC');

    // Click "Suggest FEFO Units"
    const findBtn = screen.getByTestId('btn-find-fefo');
    fireEvent.click(findBtn);

    expect(await screen.findByTestId('fefo-allocation-table')).toBeInTheDocument();
    expect(screen.getByText('#1 (Soonest Expiry)')).toBeInTheDocument();
    expect(screen.getByTestId('fefo-row-U-2026-000004')).toBeInTheDocument();
  });

  it('displays a clear message when no compatible units are found for the selected criteria', async () => {
    server.fefo = jsonResponse(200, {
      patientBloodGroup: 'O-',
      component: 'CRYO',
      suggestedUnits: [],
    });

    render(<InventoryDashboard />);

    const groupSelect = await screen.findByTestId('fefo-patient-group-select');
    fireEvent.change(groupSelect, { target: { value: 'O-' } });

    const findBtn = screen.getByTestId('btn-find-fefo');
    fireEvent.click(findBtn);

    expect(await screen.findByTestId('no-fefo-units-msg')).toBeInTheDocument();
    expect(screen.queryByTestId('fefo-allocation-table')).not.toBeInTheDocument();
  });
});

describe('TC-Inv-05 (BBMS-F-034) low-stock alerts on manager dashboard', () => {
  beforeEach(() => {
    server = {
      summary: jsonResponse(200, SEED_SUMMARY),
      list: jsonResponse(200, { units: SEED_UNITS }),
      alerts: jsonResponse(200, SEED_ALERTS),
      lowStockAlerts: jsonResponse(200, SEED_LOW_STOCK_ALERTS),
    };
    apiFetch.mockImplementation(async (path) => {
      let route;
      if (path.startsWith('/api/inventory/summary')) {
        route = server.summary;
      } else if (path.startsWith('/api/inventory/alerts/low-stock') || path.startsWith('/api/inventory/low-stock-alerts')) {
        route = server.lowStockAlerts;
      } else if (path.startsWith('/api/inventory/alerts') || path.startsWith('/api/inventory/expiry-alerts')) {
        route = server.alerts;
      } else if (path.startsWith('/api/inventory/fefo')) {
        route = server.fefo;
      } else {
        route = server.list;
      }
      if (route instanceof Error) throw route;
      return route;
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('renders the low-stock alerts card with default threshold 3 and displays groups below safety threshold', async () => {
    render(<InventoryDashboard />);

    expect(await screen.findByTestId('low-stock-alerts-card')).toBeInTheDocument();
    expect(screen.getByTestId('stat-low-stock-groups')).toHaveTextContent('2');

    const lowStockTable = screen.getByTestId('low-stock-alerts-table');
    expect(lowStockTable).toBeInTheDocument();

    // Out of stock group: B+
    const bPlusRow = screen.getByTestId('low-stock-row-B+');
    expect(bPlusRow).toHaveTextContent('B+');
    expect(bPlusRow).toHaveTextContent('0 units');
    expect(bPlusRow).toHaveTextContent('+3 needed');
    expect(bPlusRow).toHaveTextContent('Out of stock');

    // Low stock group: O-
    const oMinusRow = screen.getByTestId('low-stock-row-O-');
    expect(oMinusRow).toHaveTextContent('O-');
    expect(oMinusRow).toHaveTextContent('2 units');
    expect(oMinusRow).toHaveTextContent('+1 needed');
    expect(oMinusRow).toHaveTextContent('Low stock');
  });

  it('allows changing the safety threshold and re-fetches alerts with the new threshold', async () => {
    render(<InventoryDashboard pollIntervalMs={50} />);

    const select = await screen.findByTestId('low-stock-threshold-select');
    expect(select).toHaveValue('3');

    // Change threshold to 2 where O- (2 units) is no longer below threshold
    server.lowStockAlerts = jsonResponse(200, {
      threshold: 2,
      alertCount: 1,
      alerts: [
        {
          bloodGroup: 'B+',
          availableUnits: 0,
          volumeMl: 0,
          threshold: 2,
          deficit: 2,
          urgency: 'OUT_OF_STOCK',
          message: 'Critical shortage: Blood group B+ is OUT OF STOCK (0 units available, safety threshold is 2)',
        },
      ],
      stockByGroup: [],
    });

    fireEvent.change(select, { target: { value: '2' } });

    await waitFor(() => {
      expect(screen.getByTestId('stat-low-stock-groups')).toHaveTextContent('1');
    });
    expect(screen.queryByTestId('low-stock-row-O-')).not.toBeInTheDocument();
    expect(screen.getByTestId('low-stock-row-B+')).toBeInTheDocument();
  });

  it('displays a reassurance message when all blood groups meet the safety threshold', async () => {
    server.lowStockAlerts = jsonResponse(200, {
      threshold: 1,
      alertCount: 0,
      alerts: [],
      stockByGroup: [],
    });

    render(<InventoryDashboard />);

    expect(await screen.findByTestId('no-low-stock-alerts')).toHaveTextContent(
      'All blood groups meet or exceed the safety threshold of 3 units. Safe inventory levels.'
    );
    expect(screen.queryByTestId('low-stock-alerts-table')).not.toBeInTheDocument();
  });
});
