import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CampRecordForm from './CampRecordForm';

function savedOk(payload) {
  return { ok: true, record: { clientRef: '3f2a9c1b-0d4e-4f6a-9b8c-1a2b3c4d5e6f', payload } };
}

async function fillRequired(user) {
  await user.type(screen.getByLabelText(/Camp location/), 'Camp A');
  await user.type(screen.getByLabelText(/Donor ID/), 'D-000001');
}

describe('TC-Don-04: camp record form (client)', () => {
  it('sends a complete record with the original collection time as an ISO date', async () => {
    const onSave = vi.fn(savedOk);
    const user = userEvent.setup();
    render(<CampRecordForm onSave={onSave} />);

    await fillRequired(user);
    const when = screen.getByLabelText(/Collected at/);
    await user.clear(when);
    await user.type(when, '2026-11-05T09:30');
    await user.click(screen.getByRole('button', { name: 'Save camp record' }));

    expect(onSave).toHaveBeenCalledWith({
      donorId: 'D-000001',
      campLocation: 'Camp A',
      collectedAt: new Date('2026-11-05T09:30').toISOString(),
      donationType: 'WHOLE_BLOOD',
      volumeMl: 450,
      vitals: { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, hemoglobinGDl: 13.5 },
    });
    expect(screen.getByTestId('camp-saved')).toHaveTextContent('3F2A9C1B');
  });

  it('requires a camp location and a valid donor ID', async () => {
    const onSave = vi.fn(savedOk);
    const user = userEvent.setup();
    render(<CampRecordForm onSave={onSave} />);

    await user.type(screen.getByLabelText(/Donor ID/), '12');
    await user.click(screen.getByRole('button', { name: 'Save camp record' }));

    expect(screen.getByText('Camp location is required')).toBeInTheDocument();
    expect(screen.getByText('Donor ID must look like D-000001')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a collection time in the future', async () => {
    const onSave = vi.fn(savedOk);
    const user = userEvent.setup();
    render(<CampRecordForm onSave={onSave} />);

    await fillRequired(user);
    const when = screen.getByLabelText(/Collected at/);
    await user.clear(when);
    await user.type(when, '2099-01-01T10:00');
    await user.click(screen.getByRole('button', { name: 'Save camp record' }));

    expect(screen.getByText('Collection date and time cannot be in the future')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('blocks haemoglobin 12.4 g/dL (boundary), the same rule as the desk', async () => {
    const onSave = vi.fn(savedOk);
    const user = userEvent.setup();
    render(<CampRecordForm onSave={onSave} />);

    await fillRequired(user);
    const hb = screen.getByLabelText(/Haemoglobin/);
    await user.clear(hb);
    await user.type(hb, '12.4');
    await user.click(screen.getByRole('button', { name: 'Save camp record' }));

    expect(screen.getByText(/Haemoglobin must be at least 12.5/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('tells the collector to use the paper log if the browser cannot save', async () => {
    const user = userEvent.setup();
    render(<CampRecordForm onSave={() => ({ ok: false })} />);

    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Save camp record' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/paper log/);
  });
});
