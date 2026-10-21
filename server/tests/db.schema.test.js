const db = require('../src/db');

const EXPECTED_TABLES = [
  'users', 'donors', 'donations', 'blood_requests', 'blood_units',
  'lab_results', 'crossmatches', 'issuances', 'audit_log',
];

describe('Database schema v1', () => {
  afterAll(() => db.end());

  it('has all 9 tables', async () => {
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

  it('rejects a donation for a donor that does not exist', async () => {
    await expect(
      db.query('INSERT INTO donations (donor_id) VALUES (?)', [999999])
    ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
  });
});
