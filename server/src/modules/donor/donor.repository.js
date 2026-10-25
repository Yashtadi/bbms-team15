const db = require('../../db');

/**
 * Finds a donor by their unique ID proof number.
 * @param {string} idProof
 * @returns {Promise<object|null>}
 */
async function findByIdProof(idProof) {
  const [rows] = await db.query(
    'SELECT id, donor_code, id_proof, full_name, eligibility_status FROM donors WHERE id_proof = ?',
    [idProof]
  );
  return rows[0] || null;
}

/**
 * Finds a donor by their ID.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findById(id) {
  const [rows] = await db.query('SELECT * FROM donors WHERE id = ?', [id]);
  return rows[0] || null;
}

/**
 * Finds a donor by numeric ID or donor_code string (e.g. 1 or 'D-000001').
 * @param {number|string} idOrCode
 * @returns {Promise<object|null>}
 */
async function findByIdOrCode(idOrCode) {
  const isNumeric = /^\d+$/.test(String(idOrCode));
  const query = isNumeric
    ? 'SELECT * FROM donors WHERE id = ?'
    : 'SELECT * FROM donors WHERE donor_code = ?';
  const [rows] = await db.query(query, [idOrCode]);
  return rows[0] || null;
}

/**
 * Finds the latest completed donation for a given donor.
 * @param {number} donorId
 * @returns {Promise<object|null>}
 */
async function findLastDonation(donorId) {
  const [rows] = await db.query(
    `SELECT id, donor_id, collected_at, status, volume_ml
     FROM donations
     WHERE donor_id = ? AND status = 'COMPLETED'
     ORDER BY collected_at DESC
     LIMIT 1`,
    [donorId]
  );
  return rows[0] || null;
}

/**
 * Updates a donor's eligibility status, deferral reason, and deferral end date.
 * @param {number} id
 * @param {{ status: string, deferralReason?: string|null, deferredUntil?: string|null }} data
 * @returns {Promise<void>}
 */
async function updateEligibility(id, { status, deferralReason = null, deferredUntil = null }) {
  await db.query(
    `UPDATE donors
     SET eligibility_status = ?, deferral_reason = ?, deferred_until = ?
     WHERE id = ?`,
    [status, deferralReason, deferredUntil, id]
  );
}

/**
 * Generates the next sequential donor code (e.g. D-000006).
 * @returns {Promise<string>}
 */
async function generateNextDonorCode() {
  const [rows] = await db.query('SELECT MAX(id) AS maxId FROM donors');
  const nextId = (rows[0]?.maxId || 0) + 1;
  return `D-${String(nextId).padStart(6, '0')}`;
}

/**
 * Inserts a new donor record into MySQL using parameterized query.
 * @param {object} donor
 * @returns {Promise<object>}
 */
async function createDonor(donor) {
  const {
    donorCode,
    fullName,
    dateOfBirth,
    gender,
    phone,
    email = null,
    address = null,
    idProof,
    medicalHistory = null,
    eligibilityStatus = 'PENDING',
  } = donor;

  const [result] = await db.query(
    `INSERT INTO donors (
      donor_code, full_name, date_of_birth, gender, phone, email,
      address, id_proof, medical_history, eligibility_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      donorCode,
      fullName,
      dateOfBirth,
      gender,
      phone,
      email,
      address,
      idProof,
      medicalHistory,
      eligibilityStatus,
    ]
  );

  return {
    id: result.insertId,
    donorCode,
    eligibilityStatus,
  };
}

module.exports = {
  findByIdProof,
  findById,
  findByIdOrCode,
  findLastDonation,
  updateEligibility,
  generateNextDonorCode,
  createDonor,
};
