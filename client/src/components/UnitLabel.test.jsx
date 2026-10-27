import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import JsBarcode from 'jsbarcode';
import UnitLabel from './UnitLabel';

// Keep the real barcode drawing, but record what it was asked to encode
vi.mock('jsbarcode', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: vi.fn(actual.default) };
});

const PENDING_UNIT = {
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

describe('TC-Don-03: UnitLabel (client)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('draws a Code 128 barcode that encodes the unit ID (AC 1)', () => {
    render(<UnitLabel unit={PENDING_UNIT} />);

    const barcode = screen.getByRole('img', { name: 'Barcode for U-2026-000007' });
    expect(JsBarcode).toHaveBeenCalledWith(
      barcode,
      'U-2026-000007',
      expect.objectContaining({ format: 'CODE128', displayValue: false }),
    );
    // The bars were actually drawn into the svg
    expect(barcode.querySelectorAll('rect').length).toBeGreaterThan(10);
  });

  it('shows the unit ID, PENDING blood group and collection date (AC 2)', () => {
    render(<UnitLabel unit={PENDING_UNIT} />);

    expect(screen.getByTestId('label-unit-id')).toHaveTextContent('U-2026-000007');
    expect(screen.getByTestId('label-blood-group')).toHaveTextContent('PENDING');
    expect(screen.getByTestId('label-collected')).toHaveTextContent('27 Oct 2026');
    expect(screen.getByTestId('label-expires')).toHaveTextContent('01 Dec 2026');
    expect(screen.getByTestId('label-component')).toHaveTextContent('Whole Blood');
  });

  it('shows the tested blood group once the lab has set it (AC 2)', () => {
    render(<UnitLabel unit={{ ...PENDING_UNIT, bloodGroup: 'O-' }} />);

    expect(screen.getByTestId('label-blood-group')).toHaveTextContent('O-');
  });

  it('redraws the barcode when a different unit is shown', () => {
    const { rerender } = render(<UnitLabel unit={PENDING_UNIT} />);
    const other = { ...PENDING_UNIT, unitId: 'U-2026-000008', barcode: { format: 'CODE128', value: 'U-2026-000008' } };

    rerender(<UnitLabel unit={other} />);

    expect(JsBarcode).toHaveBeenLastCalledWith(expect.anything(), 'U-2026-000008', expect.anything());
    expect(screen.getByRole('img', { name: 'Barcode for U-2026-000008' })).toBeInTheDocument();
  });
});
