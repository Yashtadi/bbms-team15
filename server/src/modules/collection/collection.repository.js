const crypto = require('crypto');
const db = require('../../db');

/**
 * Finds a donation record by its primary key ID.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findById(id) {
  const [rows] = await db.query('SELECT * FROM donations WHERE id = ?', [id]);
  return rows[0] || null;
}

/**
 * BBMS-F-010: Inserts a donation session and its blood unit in one transaction,
 * so a session never exists without its unit (or the other way round).
 *
 * unit_code is NOT NULL and UNIQUE, but the real code is built from the unit's own id.
 * So the unit is inserted with a random placeholder, then given its real code before
 * commit (same race-free idea as donor_code, #46). Other connections never see the placeholder.
 *
 * @param {object} data
 * @param {function(number): string} data.buildUnitCode turns the new unit's id into its unit code
 * @returns {Promise<{ donationId: number, unit: { id: number, unitCode: string } }>}
 */
async function createSession(data) {
  const {
    donorId,
    collectedBy,
    collectedAt,
    donationType,
    campLocation = null,
    volumeMl,
    weightKg = null,
    hemoglobinGDl = null,
    unit,
    buildUnitCode,
  } = data;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [donationResult] = await connection.query(
      `INSERT INTO donations (
        donor_id, collected_by, collected_at, camp_location, donation_type,
        status, volume_ml, weight_kg, hemoglobin_g_dl
      ) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?)`,
      [donorId, collectedBy, collectedAt, campLocation, donationType, volumeMl, weightKg, hemoglobinGDl]
    );
    const donationId = donationResult.insertId;

    const placeholderCode = `TMP-${crypto.randomBytes(12).toString('hex')}`;
    const [unitResult] = await connection.query(
      `INSERT INTO blood_units (
        unit_code, donation_id, component, volume_ml, collected_at, expires_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'QUARANTINE')`,
      [placeholderCode, donationId, unit.component, unit.volumeMl, collectedAt, unit.expiresAt]
    );
    const unitId = unitResult.insertId;

    const unitCode = buildUnitCode(unitId);
    await connection.query('UPDATE blood_units SET unit_code = ? WHERE id = ?', [unitCode, unitId]);

    await connection.commit();

    return {
      donationId,
      unit: { id: unitId, unitCode },
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// BBMS-F-011: One fixed statement per phase, so column names never come from input.
const UPDATE_VITALS_SQL = {
  PRE: `UPDATE donations
        SET bp_systolic = ?, bp_diastolic = ?, pulse_bpm = ?, hemoglobin_g_dl = ?
        WHERE id = ?`,
  POST: `UPDATE donations
         SET post_bp_systolic = ?, post_bp_diastolic = ?, post_pulse_bpm = ?, post_hemoglobin_g_dl = ?
         WHERE id = ?`,
};

/**
 * BBMS-F-011: Stores pre- or post-donation vitals on a donation, overwriting earlier readings.
 * @param {number} donationId
 * @param {string} phase PRE or POST
 * @param {{ bpSystolic: number, bpDiastolic: number, pulseBpm: number, hemoglobinGDl: number }} vitals
 * @returns {Promise<void>}
 */
async function updateVitals(donationId, phase, vitals) {
  const sql = UPDATE_VITALS_SQL[phase];
  if (!sql) {
    throw new Error(`Unknown vitals phase "${phase}"`);
  }
  await db.query(sql, [
    vitals.bpSystolic,
    vitals.bpDiastolic,
    vitals.pulseBpm,
    vitals.hemoglobinGDl,
    donationId,
  ]);
}

module.exports = {
  createSession,
  findById,
  updateVitals,
};
