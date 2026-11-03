const inventoryRepository = require('../../src/modules/inventory/inventory.repository');
const inventoryService = require('../../src/modules/inventory/inventory.service');

jest.mock('../../src/modules/inventory/inventory.repository');

describe('TC-Inv-01 (BBMS-F-030) inventory stock summary service', () => {
  const now = new Date('2026-11-03T10:00:00.000Z');

  beforeEach(() => jest.clearAllMocks());

  it('maps each blood group + component row and adds up the totals', async () => {
    inventoryRepository.summarizeAvailable.mockResolvedValue([
      { blood_group: 'A+', component: 'PRBC', units: 2, volume_ml: '440', next_expiry: '2026-11-05T10:00:00.000Z' },
      { blood_group: 'O-', component: 'FFP', units: 1, volume_ml: '200', next_expiry: '2027-10-20T10:00:00.000Z' },
    ]);

    const summary = await inventoryService.getStockSummary({ now });

    expect(summary).toEqual({
      generatedAt: '2026-11-03T10:00:00.000Z',
      totals: { units: 3, volumeMl: 640, nextExpiry: '2026-11-05T10:00:00.000Z' },
      stock: [
        { bloodGroup: 'A+', component: 'PRBC', units: 2, volumeMl: 440, nextExpiry: '2026-11-05T10:00:00.000Z' },
        { bloodGroup: 'O-', component: 'FFP', units: 1, volumeMl: 200, nextExpiry: '2027-10-20T10:00:00.000Z' },
      ],
    });
  });

  it('picks the soonest expiry overall, whatever order the rows come in', async () => {
    inventoryRepository.summarizeAvailable.mockResolvedValue([
      { blood_group: 'B+', component: 'FFP', units: 1, volume_ml: '200', next_expiry: '2027-01-01T00:00:00.000Z' },
      { blood_group: 'AB-', component: 'PLATELETS', units: 1, volume_ml: '50', next_expiry: '2026-11-04T00:00:00.000Z' },
    ]);

    const summary = await inventoryService.getStockSummary({ now });

    expect(summary.totals.nextExpiry).toBe('2026-11-04T00:00:00.000Z');
  });

  it('returns zero totals and an empty stock list when nothing is releasable (boundary)', async () => {
    inventoryRepository.summarizeAvailable.mockResolvedValue([]);

    const summary = await inventoryService.getStockSummary({ now });

    expect(summary).toEqual({
      generatedAt: '2026-11-03T10:00:00.000Z',
      totals: { units: 0, volumeMl: 0, nextExpiry: null },
      stock: [],
    });
  });

  it('passes database errors up to the route', async () => {
    inventoryRepository.summarizeAvailable.mockRejectedValue(new Error('connection lost'));

    await expect(inventoryService.getStockSummary({ now })).rejects.toThrow('connection lost');
  });
});
