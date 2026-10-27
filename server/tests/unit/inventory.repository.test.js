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
