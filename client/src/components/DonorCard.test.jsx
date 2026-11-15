import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DonorCard from './DonorCard';

describe('DonorCard component', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockDonor = {
    donorCode: 'D-000001',
    fullName: 'Ravi Kumar',
    dateOfBirth: '1995-04-12',
    gender: 'MALE',
    bloodGroup: 'O-',
    phone: '9000000001',
    maskedIdProof: '****0001',
  };

  it('renders official donor identity card fields', () => {
    render(<DonorCard donor={mockDonor} />);

    expect(screen.getByTestId('donor-card')).toBeInTheDocument();
    expect(screen.getByTestId('card-donor-name')).toHaveTextContent('Ravi Kumar');
    expect(screen.getByTestId('donor-id')).toHaveTextContent('D-000001');
    expect(screen.getByTestId('card-blood-group')).toHaveTextContent('O-');
    expect(screen.getByText('9000000001')).toBeInTheDocument();
    expect(screen.getByText('****0001')).toBeInTheDocument();
  });

  it('masks raw government ID proof to only show last 4 characters', () => {
    const rawDonor = {
      ...mockDonor,
      maskedIdProof: undefined,
      idProof: '385859302',
    };
    render(<DonorCard donor={rawDonor} />);
    expect(screen.getByText('****9302')).toBeInTheDocument();
  });

  it('does NOT display any password on the card itself (privacy & security)', () => {
    render(<DonorCard donor={mockDonor} />);

    expect(screen.queryByText(/Default Password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/12041995/i)).not.toBeInTheDocument();
    expect(screen.getByText(/portal\.pes\.edu/i)).toBeInTheDocument();
    expect(screen.getByText(/Log in with your Donor ID/i)).toBeInTheDocument();
    expect(screen.getByText(/1800-BLOOD-PES/i)).toBeInTheDocument();
  });

  it('does NOT display any Pending Test badge when blood group is unassigned', () => {
    const unassignedDonor = {
      donorCode: 'D-000105',
      fullName: 'Shaunak Mahajan',
      dateOfBirth: '2005-10-21',
      phone: '5858493980',
    };
    render(<DonorCard donor={unassignedDonor} />);

    expect(screen.queryByText(/Pending/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-blood-group')).not.toBeInTheDocument();
  });

  it('renders print and PNG download action buttons', () => {
    render(<DonorCard donor={mockDonor} showActions={true} />);

    expect(screen.getByRole('button', { name: /Print Donor Card/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download PNG Card/i })).toBeInTheDocument();
  });
});
