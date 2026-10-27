const db = require('../../src/db');

const EXPECTED_TABLES = [
  'users', 'donors', 'donations', 'blood_requests', 'blood_units',
  'lab_results', 'crossmatches', 'issuances', 'audit_log', 'notifications',
];

describe('Database schema v1', () => {
  afterAll(() => db.end());

  it('has all 10 tables', async () => {
    const [rows] = await db.query('SHOW TABLES');
    const tables = rows.map((row) => Object.values(row)[0]);

    expect(tables.sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it('starts new blood units in QUARANTINE', async () => {
    const [rows] = await db.query(
      `SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blood_units' AND COLUMN_NAME = 'status'`
    );

    expect(rows[0].COLUMN_DEFAULT).toBe('QUARANTINE');
  });

  it('stores TTI method, blood-group verification state, and donor follow-up flags', async () => {
    const [labColumns] = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lab_results'`
    );
    const labColumnNames = labColumns.map((row) => row.COLUMN_NAME);
    expect(labColumnNames).toEqual(expect.arrayContaining([
      'method',
      'verification_result',
      'verification_status',
    ]));

    const [donorColumns] = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donors'`
    );
    expect(donorColumns.map((row) => row.COLUMN_NAME)).toEqual(
      expect.arrayContaining(['follow_up_required', 'follow_up_reason'])
    );
  });

  it('rejects a donation for a donor that does not exist', async () => {
    await expect(
      db.query('INSERT INTO donations (donor_id) VALUES (?)', [999999])
    ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
  });
});
