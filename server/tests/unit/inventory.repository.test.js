const db = require('../../src/db');
const inventoryRepository = require('../../src/modules/inventory/inventory.repository');

jest.mock('../../src/db');

describe('BBMS-F-022 available inventory query', () => {
  beforeEach(() => jest.clearAllMocks());

  it('only returns unexpired AVAILABLE units with verified blood group and all five non-reactive TTI results', async () => {
    db.query.mockResolvedValue([[]]);

    await inventoryRepository.listAvailable();

    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain("bu.status = 'AVAILABLE'");
    expect(sql).toContain('bu.expires_at > NOW()');
    expect(sql).toContain("abo.verification_status = 'VERIFIED'");
    expect(sql).toContain("tti.result = 'NON_REACTIVE'");
    expect(sql).toContain(') = 5');
  });

  it('parameterizes optional blood-group and component filters', async () => {
    db.query.mockResolvedValue([[]]);

    await inventoryRepository.listAvailable({ bloodGroup: 'O-', component: 'PRBC' });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('bu.blood_group = ?'),
      ['O-', 'PRBC']
    );
    expect(db.query.mock.calls[0][0]).toContain('bu.component = ?');
  });
});

describe('TC-Inv-01 (BBMS-F-030) stock summary query', () => {
  beforeEach(() => jest.clearAllMocks());

  it('applies the same release gate as the unit list, so quarantined or unsafe units are never counted', async () => {
    db.query.mockResolvedValue([[]]);

    await inventoryRepository.summarizeAvailable();

    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain("bu.status = 'AVAILABLE'");
    expect(sql).toContain('bu.expires_at > NOW()');
    expect(sql).toContain("abo.verification_status = 'VERIFIED'");
    expect(sql).toContain("tti.result = 'NON_REACTIVE'");
    expect(sql).toContain(') = 5');
    expect(values).toEqual([]);
  });

  it('groups by blood group and component and returns count, volume and soonest expiry', async () => {
    const rows = [{ blood_group: 'O-', component: 'PRBC', units: 1, volume_ml: '280', next_expiry: new Date() }];
    db.query.mockResolvedValue([rows]);

    const result = await inventoryRepository.summarizeAvailable();

    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('GROUP BY bu.blood_group, bu.component');
    expect(sql).toContain('COUNT(*) AS units');
    expect(sql).toContain('SUM(bu.volume_ml) AS volume_ml');
    expect(sql).toContain('MIN(bu.expires_at) AS next_expiry');
    expect(result).toBe(rows);
  });
});

describe('TC-Inv-03 (BBMS-F-032) expiry alerts repository query', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queries blood units expiring between now and threshold date with status in active bank inventory', async () => {
    const fakeRows = [
      { id: 4, unit_code: 'U-2026-000004', blood_group: 'A+', component: 'PRBC', expires_at: '2026-11-05T00:00:00.000Z' },
    ];
    db.query.mockResolvedValue([fakeRows]);

    const now = new Date('2026-11-03T00:00:00.000Z');
    const result = await inventoryRepository.findExpiringUnits({
      thresholdDays: 3,
      statuses: ['AVAILABLE', 'QUARANTINE', 'RESERVED'],
      now,
    });

    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain('bu.status IN (?)');
    expect(sql).toContain('bu.expires_at > ?');
    expect(sql).toContain('bu.expires_at <= ?');
    expect(sql).toContain('ORDER BY bu.expires_at ASC, bu.id ASC');
    expect(values[0]).toEqual(['AVAILABLE', 'QUARANTINE', 'RESERVED']);
    expect(values[1]).toEqual(now);
    expect(values[2]).toEqual(new Date('2026-11-06T00:00:00.000Z'));
    expect(result).toBe(fakeRows);
  });
});
