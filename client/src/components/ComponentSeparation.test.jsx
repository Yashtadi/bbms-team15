import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ComponentSeparation from './ComponentSeparation';

const PARENT = {
  unitId: 'U-2026-000007',
  barcode: { format: 'CODE128', value: 'U-2026-000007' },
  bloodGroup: 'PENDING',
  component: 'WHOLE_BLOOD',
  volumeMl: 450,
  status: 'QUARANTINE',
  collectedAt: '2026-11-05T10:00:00.000Z',
  expiresAt: '2026-12-10T10:00:00.000Z',
  donationId: 4,
  parentUnitCode: null,
};

function child(n, component, days) {
  const unitId = `U-2026-00010${n}`;
  return {
    ...PARENT,
    unitId,
    barcode: { format: 'CODE128', value: unitId },
    component,
    volumeMl: 100,
    expiresAt: new Date(new Date(PARENT.collectedAt).getTime() + days * 86400000).toISOString(),
    parentUnitCode: PARENT.unitId,
  };
}

function mockFetch(status, body) {
  globalThis.fetch = vi.fn().mockResolvedValue({ status, json: async () => body });
  return globalThis.fetch;
}

describe('TC-Inv-02: component separation panel (client)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['a PRBC unit', { component: 'PRBC' }],
    ['an already SEPARATED unit', { status: 'SEPARATED' }],
    ['a DISCARDED unit', { status: 'DISCARDED' }],
    ['an ISSUED unit', { status: 'ISSUED' }],
  ])('is not offered for %s', (label, overrides) => {
    render(<ComponentSeparation unit={{ ...PARENT, ...overrides }} />);
    expect(screen.queryByRole('button', { name: 'Separate components' })).not.toBeInTheDocument();
  });

  it.each(['QUARANTINE', 'AVAILABLE'])('is offered for a %s whole-blood unit', (status) => {
    render(<ComponentSeparation unit={{ ...PARENT, status }} />);
    expect(screen.getByRole('button', { name: 'Separate components' })).toBeInTheDocument();
  });

  it('posts the chosen components in a fixed order and prints a label for each child with its parent', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(201, {
      parent: { ...PARENT, status: 'SEPARATED' },
      children: [child(1, 'PRBC', 42), child(2, 'FFP', 365), child(3, 'PLATELETS', 5), child(4, 'CRYO', 365)],
    });
    const onSeparated = vi.fn();
    const onPrint = vi.fn();
    render(<ComponentSeparation unit={PARENT} onSeparated={onSeparated} onPrint={onPrint} />);

    // PRBC, FFP and Platelets are ticked by default; add Cryo
    await user.click(screen.getByLabelText('Cryo'));
    await user.click(screen.getByRole('button', { name: 'Separate components' }));

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/inventory/units/U-2026-000007/separate');
    expect(JSON.parse(options.body)).toEqual({ components: ['PRBC', 'FFP', 'PLATELETS', 'CRYO'] });

    const labels = await screen.findAllByTestId('unit-label');
    expect(labels).toHaveLength(4);
    expect(screen.getAllByTestId('label-parent').map((el) => el.textContent)).toEqual(
      Array(4).fill('From U-2026-000007')
    );
    expect(screen.getAllByTestId('label-unit-id').map((el) => el.textContent)).toEqual(
      ['U-2026-000101', 'U-2026-000102', 'U-2026-000103', 'U-2026-000104']
    );
    // Platelets expire 5 days after collection, not after separation
    expect(screen.getAllByTestId('label-expires')[2]).toHaveTextContent('10 Nov 2026');
    expect(onSeparated).toHaveBeenCalledWith(expect.objectContaining({ children: expect.any(Array) }));

    await user.click(screen.getByRole('button', { name: 'Print component labels' }));
    expect(onPrint).toHaveBeenCalled();
  });

  it('does not call the server when no component is chosen', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(201, {});
    render(<ComponentSeparation unit={PARENT} />);

    await user.click(screen.getByLabelText('PRBC (red cells)'));
    await user.click(screen.getByLabelText('FFP (plasma)'));
    await user.click(screen.getByLabelText('Platelets'));
    await user.click(screen.getByRole('button', { name: 'Separate components' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one component.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [409, { message: 'This unit has already been separated into components', code: 'ALREADY_SEPARATED' }, /already been separated/],
    [422, { message: 'PLATELETS from this unit would already be past its expiry date', code: 'COMPONENT_EXPIRED' }, /past its expiry/],
    [400, { message: 'Validation failed', errors: { components: 'Each component can be chosen only once' } }, /only once/],
  ])('shows the server message for a %i', async (status, body, text) => {
    const user = userEvent.setup();
    mockFetch(status, body);
    render(<ComponentSeparation unit={PARENT} />);

    await user.click(screen.getByRole('button', { name: 'Separate components' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByTestId('unit-label')).not.toBeInTheDocument();
  });

  it('shows a network error when the server cannot be reached', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ComponentSeparation unit={PARENT} />);

    await user.click(screen.getByRole('button', { name: 'Separate components' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Network error/);
  });
});
