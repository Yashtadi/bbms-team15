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

describe('TC-Inv-04 (BBMS-F-033) FEFO allocation service', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');

  beforeEach(() => jest.clearAllMocks());

  it('rejects invalid blood group or component with 400', async () => {
    await expect(
      inventoryService.suggestFefoAllocation({ patientBloodGroup: 'INVALID', component: 'PRBC', now })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_BLOOD_GROUP' });

    await expect(
      inventoryService.suggestFefoAllocation({ patientBloodGroup: 'A+', component: 'UNKNOWN', now })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_COMPONENT' });

    await expect(
      inventoryService.suggestFefoAllocation({ patientBloodGroup: 'A+', component: 'PRBC', unitsRequested: 0, now })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_QUANTITY' });
  });

  it('filters by clinical compatibility and suggests soonest-to-expire unit first (FEFO)', async () => {
    // Inventory has 3 units for PRBC in order of expiry:
    // 1. U-B-EXPIRING: B+ (incompatible with A+ recipient), expires in 1 day
    // 2. U-A-EXPIRING: A+ (compatible), expires in 2 days
    // 3. U-O-LATER: O- (compatible universal donor), expires in 30 days
    const mockInventory = [
      { id: 10, unit_code: 'U-B-EXPIRING', blood_group: 'B+', component: 'PRBC', volume_ml: 250, expires_at: '2026-11-04T12:00:00.000Z', status: 'AVAILABLE' },
      { id: 4, unit_code: 'U-A-EXPIRING', blood_group: 'A+', component: 'PRBC', volume_ml: 220, expires_at: '2026-11-05T12:00:00.000Z', status: 'AVAILABLE' },
      { id: 1, unit_code: 'U-O-LATER', blood_group: 'O-', component: 'PRBC', volume_ml: 280, expires_at: '2026-12-03T12:00:00.000Z', status: 'AVAILABLE' },
    ];
    inventoryRepository.findAvailableForAllocation.mockResolvedValue(mockInventory);

    const result = await inventoryService.suggestFefoAllocation({
      patientBloodGroup: 'A+',
      component: 'PRBC',
      unitsRequested: 1,
      now,
    });

    expect(result.patientBloodGroup).toBe('A+');
    expect(result.component).toBe('PRBC');
    expect(result.unitsRequested).toBe(1);
    expect(result.totalCompatibleFound).toBe(2);

    // B+ unit was rejected due to incompatibility
    expect(result.allCompatibleUnits.some((u) => u.unitCode === 'U-B-EXPIRING')).toBe(false);

    // Soonest-to-expire compatible unit is suggested first!
    expect(result.suggestedUnits.length).toBe(1);
    expect(result.suggestedUnits[0].unitCode).toBe('U-A-EXPIRING');
    expect(result.suggestedUnits[0].rank).toBe(1);
    expect(result.suggestedUnits[0].daysRemaining).toBe(2);

    // Second compatible unit is O-
    expect(result.allCompatibleUnits[1].unitCode).toBe('U-O-LATER');
    expect(result.allCompatibleUnits[1].rank).toBe(2);
  });

  it('allocates requested number of units up to availability', async () => {
    const mockInventory = [
      { id: 4, unit_code: 'U-1', blood_group: 'O-', component: 'PRBC', volume_ml: 220, expires_at: '2026-11-05T12:00:00.000Z', status: 'AVAILABLE' },
      { id: 1, unit_code: 'U-2', blood_group: 'O-', component: 'PRBC', volume_ml: 280, expires_at: '2026-12-03T12:00:00.000Z', status: 'AVAILABLE' },
    ];
    inventoryRepository.findAvailableForAllocation.mockResolvedValue(mockInventory);

    const result = await inventoryService.suggestFefoAllocation({
      patientBloodGroup: 'O-',
      component: 'PRBC',
      unitsRequested: 2,
      now,
    });

    expect(result.suggestedUnits.length).toBe(2);
    expect(result.suggestedUnits[0].unitCode).toBe('U-1');
    expect(result.suggestedUnits[1].unitCode).toBe('U-2');
  });

  it('returns empty suggestions when no compatible units exist in inventory', async () => {
    inventoryRepository.findAvailableForAllocation.mockResolvedValue([]);

    const result = await inventoryService.suggestFefoAllocation({
      patientBloodGroup: 'O-',
      component: 'PRBC',
      unitsRequested: 1,
      now,
    });

    expect(result.totalCompatibleFound).toBe(0);
    expect(result.suggestedUnits).toEqual([]);
    expect(result.allCompatibleUnits).toEqual([]);
  });
});
