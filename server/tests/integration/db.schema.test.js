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

  it('requires explicit MFA enrollment for privileged users and allows unknown request blood groups', async () => {
    const [mfa] = await db.query(
      `SELECT IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'mfa_enabled'`
    );
    expect(mfa).toHaveLength(1);
    expect(mfa[0].IS_NULLABLE).toBe('NO');
    expect(Number(mfa[0].COLUMN_DEFAULT)).toBe(0);

    const [bloodGroup] = await db.query(
      `SELECT IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blood_requests' AND COLUMN_NAME = 'patient_blood_group'`
    );
    expect(bloodGroup[0].IS_NULLABLE).toBe('YES');
  });

  it('rejects a donation for a donor that does not exist', async () => {
    await expect(
      db.query('INSERT INTO donations (donor_id) VALUES (?)', [999999])
    ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
  });

  it('TC-Don-04: has a nullable, unique donations.client_ref for offline camp sync', async () => {
    const [rows] = await db.query(
      `SELECT IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donations' AND COLUMN_NAME = 'client_ref'`
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].IS_NULLABLE).toBe('YES');
    expect(rows[0].COLUMN_KEY).toBe('UNI');
  });

  it('TC-Inv-02: links a component to its parent unit and allows the SEPARATED status', async () => {
    const [parent] = await db.query(
      `SELECT IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blood_units' AND COLUMN_NAME = 'parent_unit_id'`
    );
    expect(parent).toHaveLength(1);
    expect(parent[0].IS_NULLABLE).toBe('YES');

    const [status] = await db.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blood_units' AND COLUMN_NAME = 'status'`
    );
    expect(status[0].COLUMN_TYPE).toContain("'SEPARATED'");

    await expect(
      db.query('UPDATE blood_units SET parent_unit_id = ? WHERE id = 1', [999999])
    ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
  });
});
