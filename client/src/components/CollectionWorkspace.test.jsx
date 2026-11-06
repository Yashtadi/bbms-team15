import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollectionWorkspace from './CollectionWorkspace';
import { saveSession } from '../api';
import { enqueue, loadQueue, queueKey } from '../offlineQueue';

const USER_ID = 3;

function setOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
}

function campPayload(donorId = 'D-000001') {
  return {
    donorId,
    campLocation: 'Camp A',
    collectedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    donationType: 'WHOLE_BLOOD',
    volumeMl: 450,
    vitals: { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, hemoglobinGDl: 13.5 },
  };
}

function seedRejected(donorId, error) {
  const { record } = enqueue(USER_ID, campPayload(donorId));
  const queue = loadQueue(USER_ID);
  queue.records = queue.records.map((r) =>
    r.clientRef === record.clientRef ? { ...r, state: 'REJECTED', error } : r
  );
  localStorage.setItem(queueKey(USER_ID), JSON.stringify(queue));
  return record.clientRef;
}

function unitFor(n) {
  const unitId = `U-2026-${String(n).padStart(6, '0')}`;
  return {
    unitId,
    barcode: { format: 'CODE128', value: unitId },
    bloodGroup: 'PENDING',
    component: 'WHOLE_BLOOD',
    volumeMl: 450,
    status: 'QUARANTINE',
    collectedAt: '2026-11-06T08:00:00.000Z',
    expiresAt: '2026-12-11T08:00:00.000Z',
  };
}

// Server stand-in for POST /api/donations/sync: every record is created
function syncServer() {
  return vi.fn(async (path, options) => {
    const { records } = JSON.parse(options.body);
    return {
      status: 200,
      json: async () => ({
        results: records.map((r, i) => ({ clientRef: r.clientRef, status: 201, unit: unitFor(i + 1) })),
      }),
    };
  });
}

function sentRefs(fetchMock, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body).records.map((r) => r.clientRef);
}

describe('TC-Don-04: outreach camp mode and offline sync (client)', () => {
  beforeEach(() => {
    saveSession({ token: 'fake-token', user: { id: USER_ID, role: 'LAB_TECH', email: 'collector@bbms.test' } });
  });

  afterEach(() => {
    setOnline(true);
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('opens the normal collection desk when online', () => {
    setOnline(true);
    render(<CollectionWorkspace />);

    expect(screen.getByRole('heading', { level: 2, name: 'Blood Collection Desk' })).toBeInTheDocument();
    expect(screen.queryByTestId('camp-sync-status')).not.toBeInTheDocument();
  });

  it('opens camp mode when offline and shows "Offline — N records pending sync"', () => {
    setOnline(false);
    enqueue(USER_ID, campPayload('D-000001'));
    enqueue(USER_ID, campPayload('D-000002'));

    render(<CollectionWorkspace />);

    expect(screen.getByRole('heading', { level: 2, name: 'Outreach Camp Recording' })).toBeInTheDocument();
    expect(screen.getByTestId('camp-sync-status')).toHaveTextContent('Offline — 2 records pending sync');
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
  });

  it('warns in desk mode when the connection drops', async () => {
    setOnline(true);
    render(<CollectionWorkspace />);

    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(await screen.findByText(/You are offline. Switch to Outreach camp/)).toBeInTheDocument();
  });

  it('queues a record while offline without calling the server', async () => {
    setOnline(false);
    globalThis.fetch = vi.fn();
    const user = userEvent.setup();
    render(<CollectionWorkspace />);

    await user.type(screen.getByLabelText(/Camp location/), 'PES University camp');
    await user.type(screen.getByLabelText(/Donor ID/), 'd-000001');
    await user.click(screen.getByRole('button', { name: 'Save camp record' }));

    expect(screen.getByTestId('camp-saved')).toHaveTextContent(/Saved for D-000001/);
    expect(screen.getByTestId('camp-sync-status')).toHaveTextContent('Offline — 1 record pending sync');
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const [record] = loadQueue(USER_ID).records;
    expect(record.payload).toEqual(expect.objectContaining({
      clientRef: record.clientRef,
      donorId: 'D-000001',
      campLocation: 'PES University camp',
    }));
    expect(screen.getByTestId('camp-saved')).toHaveTextContent(record.clientRef.slice(0, 8).toUpperCase());
    // Camp location stays for the next donor; donor ID is cleared
    expect(screen.getByLabelText(/Camp location/)).toHaveValue('PES University camp');
    expect(screen.getByLabelText(/Donor ID/)).toHaveValue('');
  });

  it('syncs PENDING records (not REJECTED ones) when the connection returns', async () => {
    setOnline(false);
    const { record: pending } = enqueue(USER_ID, campPayload('D-000001'));
    const rejectedRef = seedRejected('D-000003', { status: 422, message: 'Donor is not eligible to donate' });
    globalThis.fetch = syncServer();
    render(<CollectionWorkspace />);

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => expect(screen.getAllByTestId('synced-record')).toHaveLength(1));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/donations/sync');
    expect(sentRefs(globalThis.fetch)).toEqual([pending.clientRef]);
    expect(sentRefs(globalThis.fetch)).not.toContain(rejectedRef);
    expect(screen.getByTestId('camp-sync-status')).toHaveTextContent('0 records pending sync');
    expect(screen.getAllByTestId('rejected-record')).toHaveLength(1);
  });

  it('shows a rejected record with its error, and Sync now sends it again', async () => {
    setOnline(true);
    const rejectedRef = seedRejected('D-000003', {
      status: 422,
      message: 'Donor is not eligible to donate (status DEFERRED)',
    });
    globalThis.fetch = syncServer();
    const user = userEvent.setup();
    render(<CollectionWorkspace />);

    const rejected = screen.getByTestId('rejected-record');
    expect(rejected).toHaveTextContent('D-000003');
    expect(rejected).toHaveTextContent('Donor is not eligible to donate (status DEFERRED)');
    // Automatic sync on open sends PENDING only, so nothing is sent for a rejected record
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => expect(screen.queryByTestId('rejected-record')).not.toBeInTheDocument());
    expect(sentRefs(globalThis.fetch)).toEqual([rejectedRef]);
    expect(screen.getByTestId('synced-record')).toHaveTextContent('U-2026-000001');
  });

  it('shows field errors for a 400 rejection and removes a record only after confirming', async () => {
    setOnline(true);
    seedRejected('D-000004', {
      status: 400,
      message: 'Validation failed',
      errors: { collectedAt: 'Collection date and time cannot be in the future' },
    });
    const user = userEvent.setup();
    render(<CollectionWorkspace />);

    expect(screen.getByText('Collection date and time cannot be in the future')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByTestId('rejected-record')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }));
    expect(screen.queryByTestId('rejected-record')).not.toBeInTheDocument();
    expect(loadQueue(USER_ID).records).toHaveLength(0);
  });

  it('keeps the queue and asks to log in again when the login has expired (401)', async () => {
    setOnline(true);
    enqueue(USER_ID, campPayload('D-000001'));
    const before = loadQueue(USER_ID);
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401, json: async () => ({}) });

    render(<CollectionWorkspace />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your login has expired. Log in again to sync 1 record.'
    );
    expect(loadQueue(USER_ID)).toEqual(before);
  });

  it('keeps records and explains when the server cannot be reached during Sync now', async () => {
    setOnline(true);
    seedRejected('D-000003', { status: 422, message: 'Deferred' });
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<CollectionWorkspace />);

    await user.click(screen.getByRole('button', { name: 'Sync now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the server/);
    expect(screen.getByTestId('rejected-record')).toBeInTheDocument();
  });

  it('prints the barcode label of a synced record', async () => {
    setOnline(true);
    localStorage.setItem(queueKey(USER_ID), JSON.stringify({
      records: [],
      synced: [{ clientRef: '3f2a9c1b-0d4e-4f6a-9b8c-1a2b3c4d5e6f', donorId: 'D-000001', unit: unitFor(12) }],
    }));
    window.print = vi.fn();
    const user = userEvent.setup();
    render(<CollectionWorkspace />);

    expect(screen.getByTestId('synced-record')).toHaveTextContent('3F2A9C1B');
    await user.click(screen.getByRole('button', { name: 'Show label' }));
    expect(screen.getByTestId('label-unit-id')).toHaveTextContent('U-2026-000012');

    await user.click(screen.getByRole('button', { name: 'Print label' }));
    expect(window.print).toHaveBeenCalled();
  });
});
