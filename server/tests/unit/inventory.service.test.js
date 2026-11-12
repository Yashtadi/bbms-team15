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

describe('TC-Inv-03 (BBMS-F-032) expiry alerts service', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');

  beforeEach(() => jest.clearAllMocks());

  it('rejects non-integer, negative, zero or out-of-bounds threshold days (400)', async () => {
    await expect(inventoryService.getExpiryAlerts({ thresholdDays: 0, now })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_THRESHOLD',
    });
    await expect(inventoryService.getExpiryAlerts({ thresholdDays: -2, now })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_THRESHOLD',
    });
    await expect(inventoryService.getExpiryAlerts({ thresholdDays: 'abc', now })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_THRESHOLD',
    });
    await expect(inventoryService.getExpiryAlerts({ thresholdDays: 61, now })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_THRESHOLD',
    });
  });

  it('calculates remaining time, urgency level (CRITICAL <= 24h, WARNING <= 3d) and formats alert items', async () => {
    const units = [
      {
        id: 4,
        unit_code: 'U-2026-000004',
        donation_id: 2,
        component: 'PRBC',
        blood_group: 'A+',
        volume_ml: 220,
        status: 'AVAILABLE',
        collected_at: '2026-09-24T12:00:00.000Z',
        expires_at: '2026-11-04T00:00:00.000Z', // 12 hours from now -> CRITICAL
      },
      {
        id: 7,
        unit_code: 'U-2026-000007',
        donation_id: 4,
        component: 'WHOLE_BLOOD',
        blood_group: 'B+',
        volume_ml: 350,
        status: 'QUARANTINE',
        collected_at: '2026-10-01T12:00:00.000Z',
        expires_at: '2026-11-05T12:00:00.000Z', // 48 hours (2 days) -> WARNING
      },
    ];
    inventoryRepository.findExpiringUnits.mockResolvedValue(units);

    const result = await inventoryService.getExpiryAlerts({ thresholdDays: 3, now });

    expect(result.thresholdDays).toBe(3);
    expect(result.alertCount).toBe(2);
    expect(result.alerts[0]).toEqual({
      id: 4,
      unitCode: 'U-2026-000004',
      donationId: 2,
      component: 'PRBC',
      bloodGroup: 'A+',
      volumeMl: 220,
      status: 'AVAILABLE',
      collectedAt: '2026-09-24T12:00:00.000Z',
      expiresAt: '2026-11-04T00:00:00.000Z',
      hoursRemaining: 12,
      daysRemaining: 1,
      urgency: 'CRITICAL',
    });
    expect(result.alerts[1]).toEqual({
      id: 7,
      unitCode: 'U-2026-000007',
      donationId: 4,
      component: 'WHOLE_BLOOD',
      bloodGroup: 'B+',
      volumeMl: 350,
      status: 'QUARANTINE',
      collectedAt: '2026-10-01T12:00:00.000Z',
      expiresAt: '2026-11-05T12:00:00.000Z',
      hoursRemaining: 48,
      daysRemaining: 2,
      urgency: 'WARNING',
    });
  });

  it('returns empty alert list when no units are nearing expiry', async () => {
    inventoryRepository.findExpiringUnits.mockResolvedValue([]);

    const result = await inventoryService.getExpiryAlerts({ thresholdDays: '3', now });

    expect(result.alertCount).toBe(0);
    expect(result.alerts).toEqual([]);
    expect(result.thresholdDays).toBe(3);
  });
});
