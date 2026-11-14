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
        SET bp_systolic = ?, bp_diastolic = ?, pulse_bpm = ?, hemoglobin_g_dl = ?, status = 'COMPLETED'
        WHERE id = ?`,
  POST: `UPDATE donations
         SET post_bp_systolic = ?, post_bp_diastolic = ?, post_pulse_bpm = ?, post_hemoglobin_g_dl = ?, status = 'COMPLETED'
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

/**
 * BBMS-F-012: Finds a blood unit by its unit code (the value encoded in its barcode).
 * Includes the parent's unit code when the unit is a separated component (F-031).
 * @param {string} unitCode e.g. U-2026-000001
 * @returns {Promise<object|null>}
 */
async function findUnitByCode(unitCode) {
  const [rows] = await db.query(
    `SELECT bu.id, bu.unit_code, bu.donation_id, bu.component, bu.blood_group, bu.volume_ml,
            bu.collected_at, bu.expires_at, bu.status, p.unit_code AS parent_unit_code
     FROM blood_units bu
     LEFT JOIN blood_units p ON p.id = bu.parent_unit_id
     WHERE bu.unit_code = ?`,
    [unitCode]
  );
  return rows[0] || null;
}

/**
 * BBMS-F-013: Finds a donation that was already synced from an offline camp record,
 * together with the blood unit it created (the first unit of that donation).
 * @param {string} clientRef UUID made by the browser
 * @returns {Promise<object|null>} donation_id plus the unit's columns, or null
 */
async function findSessionByClientRef(clientRef) {
  const [rows] = await db.query(
    `SELECT d.id AS donation_id, bu.id, bu.unit_code, bu.component, bu.blood_group, bu.volume_ml,
            bu.collected_at, bu.expires_at, bu.status
     FROM donations d
     JOIN blood_units bu ON bu.donation_id = d.id
     WHERE d.client_ref = ?
     ORDER BY bu.id ASC
     LIMIT 1`,
    [clientRef]
  );
  return rows[0] || null;
}

/**
 * BBMS-F-013: The donor's most recent donation (not aborted) collected at or before a time.
 * Used for the 90-day gap rule, measured from when the camp donation was actually taken.
 * @param {number} donorId
 * @param {Date} collectedAt
 * @returns {Promise<{ collected_at: Date }|null>}
 */
async function findLastDonationBefore(donorId, collectedAt) {
  const [rows] = await db.query(
    `SELECT id, collected_at FROM donations
     WHERE donor_id = ? AND status <> 'ABORTED' AND collected_at <= ?
     ORDER BY collected_at DESC, id DESC
     LIMIT 1`,
    [donorId, collectedAt]
  );
  return rows[0] || null;
}

/**
 * BBMS-F-013: Saves one synced camp record in a single transaction: the donation (with its
 * client_ref, camp location, original collection time and pre-vitals), its QUARANTINE unit,
 * the PENDING -> ELIGIBLE promotion of the donor, and an audit row. Any failure rolls back
 * everything, so a record is either fully saved or not at all.
 *
 * If another request saved the same client_ref first, MySQL raises ER_DUP_ENTRY and the
 * caller looks up the existing donation instead.
 *
 * @param {object} data
 * @param {function(number): string} data.buildUnitCode turns the new unit's id into its unit code
 * @returns {Promise<{ donationId: number, unit: { id: number, unitCode: string } }>}
 */
async function createSyncedSession(data) {
  const {
    clientRef,
    donorId,
    collectedBy,
    collectedAt,
    campLocation,
    donationType,
    volumeMl,
    vitals,
    unit,
    buildUnitCode,
  } = data;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [donationResult] = await connection.query(
      `INSERT INTO donations (
        client_ref, donor_id, collected_by, collected_at, camp_location, donation_type,
        status, volume_ml, bp_systolic, bp_diastolic, pulse_bpm, hemoglobin_g_dl
      ) VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?)`,
      [
        clientRef, donorId, collectedBy, collectedAt, campLocation, donationType, volumeMl,
        vitals.bpSystolic, vitals.bpDiastolic, vitals.pulseBpm, vitals.hemoglobinGDl,
      ]
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

    // Same promotion the desk does after screening with chair-side vitals (F-002 -> F-010)
    await connection.query(
      `UPDATE donors SET eligibility_status = 'ELIGIBLE', deferral_reason = NULL, deferred_until = NULL
       WHERE id = ? AND eligibility_status = 'PENDING'`,
      [donorId]
    );

    await connection.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES (?, 'DONATION_SYNCED', 'blood_unit', ?, ?)`,
      [collectedBy, unitCode, JSON.stringify({ clientRef, donationId, campLocation })]
    );

    await connection.commit();

    return { donationId, unit: { id: unitId, unitCode } };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  createSession,
  findById,
  updateVitals,
  findUnitByCode,
  findSessionByClientRef,
  findLastDonationBefore,
  createSyncedSession,
};
