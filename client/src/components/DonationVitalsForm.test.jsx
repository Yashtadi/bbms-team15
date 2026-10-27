import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DonationVitalsForm from './DonationVitalsForm';

function mockResponse(status, body) {
  globalThis.fetch = vi.fn().mockResolvedValue({ status, json: async () => body });
  return globalThis.fetch;
}

async function fillForm(user, { donationId = '21', phase, systolic = '120', diastolic = '80', pulse = '72', hb = '13.5' } = {}) {
  await user.type(screen.getByLabelText(/Donation ID/i), donationId);
  if (phase) await user.selectOptions(screen.getByLabelText(/Reading/i), phase);
  await user.type(screen.getByLabelText(/Systolic BP/i), systolic);
  await user.type(screen.getByLabelText(/Diastolic BP/i), diastolic);
  await user.type(screen.getByLabelText(/Pulse/i), pulse);
  await user.type(screen.getByLabelText(/Haemoglobin/i), hb);
}

describe('TC-Don-02: DonationVitalsForm (client)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the pre/post selector and BP, pulse and haemoglobin fields (AC 1)', () => {
    render(<DonationVitalsForm />);

    expect(screen.getByLabelText(/Donation ID/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pre-donation' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Post-donation' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Systolic BP/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Diastolic BP/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Pulse/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Haemoglobin/i)).toBeInTheDocument();
  });

  it('shows required-field errors without calling the server', async () => {
    const user = userEvent.setup();
    const fetchMock = mockResponse(200, {});
    render(<DonationVitalsForm />);

    await user.click(screen.getByRole('button', { name: /Save Vitals/i }));

    expect(screen.getByTestId('error-donationId')).toHaveTextContent('Donation ID is required');
    expect(screen.getByTestId('error-bpSystolic')).toHaveTextContent('Systolic BP is required');
    expect(screen.getByTestId('error-hemoglobinGDl')).toHaveTextContent('Haemoglobin is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends pre-donation vitals to the /pre URL and confirms the save (AC 2)', async () => {
    const user = userEvent.setup();
    const fetchMock = mockResponse(200, {
      donationId: 21,
      phase: 'PRE',
      vitals: { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, hemoglobinGDl: 13.5 },
      warnings: [],
    });
    render(<DonationVitalsForm />);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /Save Vitals/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Pre-donation vitals saved for donation #21. All readings are within the safe range.'
    );
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/donations/21/vitals/pre');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({
      bpSystolic: '120',
      bpDiastolic: '80',
      pulseBpm: '72',
      hemoglobinGDl: '13.5',
    });
    expect(screen.queryByTestId('vitals-warnings')).not.toBeInTheDocument();
  });

  it('sends post-donation vitals to the /post URL', async () => {
    const user = userEvent.setup();
    const fetchMock = mockResponse(200, { donationId: 21, phase: 'POST', vitals: {}, warnings: [] });
    render(<DonationVitalsForm />);

    await fillForm(user, { phase: 'POST' });
    await user.click(screen.getByRole('button', { name: /Save Vitals/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('Post-donation vitals saved');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/donations/21/vitals/post');
  });

  it('shows a visible warning for each out-of-range reading (AC 3)', async () => {
    const user = userEvent.setup();
    mockResponse(200, {
      donationId: 21,
      phase: 'PRE',
      vitals: { bpSystolic: 141, bpDiastolic: 80, pulseBpm: 59, hemoglobinGDl: 13.5 },
      warnings: [
        { field: 'bpSystolic', value: 141, min: 100, max: 140, message: 'Systolic BP 141 mmHg is above the safe maximum of 140 mmHg (pre-donation)' },
        { field: 'pulseBpm', value: 59, min: 60, max: 100, message: 'Pulse 59 bpm is below the safe minimum of 60 bpm (pre-donation)' },
      ],
    });
    render(<DonationVitalsForm />);

    await fillForm(user, { systolic: '141', pulse: '59' });
    await user.click(screen.getByRole('button', { name: /Save Vitals/i }));

    const warningBox = await screen.findByTestId('vitals-warnings');
    expect(warningBox).toHaveAttribute('role', 'alert');
    expect(warningBox).toHaveTextContent('Out of safe range');
    const items = within(warningBox).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Systolic BP 141 mmHg is above the safe maximum of 140 mmHg');
    expect(items[1]).toHaveTextContent('Pulse 59 bpm is below the safe minimum of 60 bpm');
  });

  it('shows server field errors for invalid values (AC 4)', async () => {
    const user = userEvent.setup();
    const fetchMock = mockResponse(400, {
      message: 'Validation failed',
      errors: { bpSystolic: 'Systolic BP must be a whole number between 1 and 300 mmHg' },
    });
    render(<DonationVitalsForm />);

    await fillForm(user, { systolic: '-120' });
    await user.click(screen.getByRole('button', { name: /Save Vitals/i }));

    // The negative value goes to the server, which owns the validation rules
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).bpSystolic).toBe('-120');
    expect(await screen.findByTestId('error-bpSystolic')).toHaveTextContent('between 1 and 300');
    expect(screen.getByTestId('general-error')).toHaveTextContent('Validation failed');
    expect(screen.queryByTestId('vitals-result')).not.toBeInTheDocument();
  });

  it('shows the server message for an unknown donation', async () => {
    const user = userEvent.setup();
    mockResponse(404, { message: 'Donation not found' });
    render(<DonationVitalsForm />);

    await fillForm(user, { donationId: '999999' });
    await user.click(screen.getByRole('button', { name: /Save Vitals/i }));

    expect(await screen.findByTestId('general-error')).toHaveTextContent('Donation not found');
  });

  it('shows a network error when the server is unreachable', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    render(<DonationVitalsForm />);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /Save Vitals/i }));

    expect(await screen.findByTestId('general-error')).toHaveTextContent('Network error');
  });
});
