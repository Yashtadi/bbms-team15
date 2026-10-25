const db = require('../../db');

/**
 * Inserts a new donation session record into MySQL.
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createDonation(data) {
  const {
    donorId,
    collectedBy = null,
    campLocation = null,
    status = 'IN_PROGRESS',
    volumeMl = null,
    weightKg = null,
    hemoglobinGDl = null,
    bpSystolic = null,
    bpDiastolic = null,
    pulseBpm = null,
    temperatureC = null,
  } = data;

  const [result] = await db.query(
    `INSERT INTO donations (
      donor_id, collected_by, camp_location, status,
      volume_ml, weight_kg, hemoglobin_g_dl,
      bp_systolic, bp_diastolic, pulse_bpm, temperature_c
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      donorId,
      collectedBy,
      campLocation,
      status,
      volumeMl,
      weightKg,
      hemoglobinGDl,
      bpSystolic,
      bpDiastolic,
      pulseBpm,
      temperatureC,
    ]
  );

  return {
    id: result.insertId,
    donorId,
    status,
  };
}

/**
 * Finds a donation record by its primary key ID.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findById(id) {
  const [rows] = await db.query('SELECT * FROM donations WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports = {
  createDonation,
  findById,
};
