import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DonorRegistrationForm from './DonorRegistrationForm';

describe('TC-Reg-01 & TC-Reg-03: DonorRegistrationForm (client)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all required registration fields', () => {
    render(<DonorRegistrationForm />);

    expect(screen.getByLabelText(/Full Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Age/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Gender/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Contact Number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ID Proof Number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Medical History/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Register Donor/i })).toBeInTheDocument();
  });

  it('validates required fields and displays field-level error messages', async () => {
    const user = userEvent.setup();
    render(<DonorRegistrationForm />);

    const submitBtn = screen.getByRole('button', { name: /Register Donor/i });
    await user.click(submitBtn);

    expect(await screen.findByTestId('error-name')).toHaveTextContent('Full name is required');
    expect(screen.getByTestId('error-age')).toHaveTextContent('Age is required');
    expect(screen.getByTestId('error-contact')).toHaveTextContent('Contact number is required');
    expect(screen.getByTestId('error-idProof')).toHaveTextContent('ID proof is required');
  });

  it('validates age boundaries (rejects < 18 or > 65)', async () => {
    const user = userEvent.setup();
    render(<DonorRegistrationForm />);

    const ageInput = screen.getByLabelText(/Age/i);
    await user.type(ageInput, '16');

    const submitBtn = screen.getByRole('button', { name: /Register Donor/i });
    await user.click(submitBtn);

    expect(await screen.findByTestId('error-age')).toHaveTextContent('Age must be between 18 and 65');
  });

  it('displays the success screen and donor card with new Donor ID on successful registration', async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn().mockResolvedValue({
      status: 201,
      json: async () => ({ donorId: 'D-000123', status: 'PENDING', fullName: 'Ramesh Patel' }),
    });

    render(<DonorRegistrationForm />);

    await user.type(screen.getByLabelText(/Full Name/i), 'Ramesh Patel');
    await user.type(screen.getByLabelText(/Age/i), '28');
    await user.selectOptions(screen.getByLabelText(/Gender/i), 'MALE');
    await user.type(screen.getByLabelText(/Contact Number/i), '9876543210');
    await user.type(screen.getByLabelText(/ID Proof Number/i), 'AADHAAR-1234');
    await user.type(screen.getByLabelText(/Medical History/i), 'None');

    const submitBtn = screen.getByRole('button', { name: /Register Donor/i });
    await user.click(submitBtn);

    expect(await screen.findByTestId('success-screen')).toBeInTheDocument();
    expect(screen.getByTestId('donor-card')).toBeInTheDocument();
    expect(screen.getByTestId('card-donor-name')).toHaveTextContent('Ramesh Patel');
    expect(screen.getByTestId('donor-id')).toHaveTextContent('D-000123');
    expect(screen.getByText('PENDING')).toBeInTheDocument();
  });

  it('handles 409 conflict when duplicate ID proof is used', async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn().mockResolvedValue({
      status: 409,
      json: async () => ({ message: 'A donor with this ID proof is already registered' }),
    });

    render(<DonorRegistrationForm />);

    await user.type(screen.getByLabelText(/Full Name/i), 'Ramesh Patel');
    await user.type(screen.getByLabelText(/Age/i), '28');
    await user.type(screen.getByLabelText(/Contact Number/i), '9876543210');
    await user.type(screen.getByLabelText(/ID Proof Number/i), 'DUPLICATE-ID');

    const submitBtn = screen.getByRole('button', { name: /Register Donor/i });
    await user.click(submitBtn);

    expect(await screen.findByTestId('general-error')).toHaveTextContent('already registered');
  });
});
