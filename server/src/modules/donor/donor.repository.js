const bcrypt = require('bcryptjs');
const db = require('../../db');
const { encrypt, decryptDonorRow } = require('../../utils/encryption');

/**
 * Derives default password in DDMMYYYY format from Date of Birth.
 * Robust against Date objects, ISO strings, and standard YYYY-MM-DD.
 */
function deriveDobPassword(dob) {
  if (!dob) return '01012000';
  const str = String(dob).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (match) {
    const [, yyyy, mm, dd] = match;
    return `${dd}${mm}${yyyy}`;
  }
  const d = new Date(dob);
  if (!isNaN(d.getTime())) {
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${dd}${mm}${yyyy}`;
  }
  return '01012000';
}

/**
 * Finds a donor by their unique ID proof number.
 * @param {string} idProof
 * @returns {Promise<object|null>}
 */
async function findByIdProof(idProof) {
  const [rows] = await db.query(
    'SELECT id, donor_code, id_proof, full_name, eligibility_status, consent_given, consent_at FROM donors WHERE id_proof = ?',
    [idProof]
  );
  return rows[0] ? decryptDonorRow(rows[0]) : null;
}

/**
 * Finds a donor by their ID.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findById(id) {
  const [rows] = await db.query('SELECT * FROM donors WHERE id = ?', [id]);
  return rows[0] ? decryptDonorRow(rows[0]) : null;
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
  return rows[0] ? decryptDonorRow(rows[0]) : null;
}

/**
 * Finds a donor by ID, donor code, or contact phone.
 * @param {string|number} queryVal
 * @returns {Promise<object|null>}
 */
async function findByIdOrCodeOrPhone(queryVal) {
  const trimmed = String(queryVal).trim();
  const isNumeric = /^\d+$/.test(trimmed);
  const query = isNumeric
    ? 'SELECT * FROM donors WHERE id = ? OR phone = ? OR donor_code = ? LIMIT 1'
    : 'SELECT * FROM donors WHERE donor_code = ? OR phone = ? LIMIT 1';
  const [rows] = await db.query(query, isNumeric ? [Number(trimmed), trimmed, trimmed] : [trimmed, trimmed]);
  return rows[0] ? decryptDonorRow(rows[0]) : null;
}

/**
 * Finds a donor by user_id (for authenticated donor portal).
 * @param {number} userId
 * @returns {Promise<object|null>}
 */
async function findByUserId(userId) {
  const [rows] = await db.query('SELECT * FROM donors WHERE user_id = ?', [userId]);
  return rows[0] ? decryptDonorRow(rows[0]) : null;
}

/**
 * Finds all donations for a donor, ordered by collection date descending.
 * @param {number} donorId
 * @returns {Promise<Array<object>>}
 */
async function findDonationsByDonorId(donorId) {
  const [rows] = await db.query(
    `SELECT id, donor_id, collected_at, status, volume_ml,
            weight_kg, hemoglobin_g_dl, bp_systolic, bp_diastolic, pulse_bpm, temperature_c
     FROM donations
     WHERE donor_id = ?
     ORDER BY collected_at DESC`,
    [donorId]
  );
  return rows;
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
  const storedDeferralReason = deferralReason ? encrypt(deferralReason) : null;
  await db.query(
    `UPDATE donors
     SET eligibility_status = ?, deferral_reason = ?, deferred_until = ?
     WHERE id = ?`,
    [status, storedDeferralReason, deferredUntil, id]
  );
}

/**
 * BBMS-F-004: Digitally captures and updates donor consent with timestamp.
 * @param {number|string} idOrCode
 * @param {boolean} consentGiven
 * @param {Date|string} consentAt
 * @returns {Promise<boolean>}
 */
async function updateConsent(idOrCode, consentGiven = true, consentAt = new Date()) {
  const isNumeric = /^\d+$/.test(String(idOrCode));
  const query = isNumeric
    ? 'UPDATE donors SET consent_given = ?, consent_at = ? WHERE id = ?'
    : 'UPDATE donors SET consent_given = ?, consent_at = ? WHERE donor_code = ?';
  const [result] = await db.query(query, [consentGiven, consentAt, idOrCode]);
  return result.affectedRows > 0;
}

/**
 * BBMS-F-003: Generates the next sequential, human-readable donor code (e.g. D-000123).
 * @returns {Promise<string>}
 */
async function generateNextDonorCode() {
  let nextSeq = 1;

  // 1. Check AUTO_INCREMENT from information_schema
  try {
    const [tableRows] = await db.query(
      `SELECT AUTO_INCREMENT 
       FROM information_schema.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donors'`
    );
    if (tableRows[0]?.AUTO_INCREMENT) {
      nextSeq = Math.max(nextSeq, Number(tableRows[0].AUTO_INCREMENT));
    }
  } catch (err) {
    // Fallback if information_schema is restricted
  }

  // 2. Check current MAX(id) in donors table
  try {
    const [maxRows] = await db.query('SELECT MAX(id) AS maxId FROM donors');
    const maxId = maxRows[0]?.maxId ? Number(maxRows[0].maxId) + 1 : 1;
    nextSeq = Math.max(nextSeq, maxId);
  } catch (err) {
    // Fallback
  }

  // 3. Check audit_log to ensure deleted donor IDs are never re-issued
  try {
    const [auditRows] = await db.query(
      `SELECT entity_id FROM audit_log 
       WHERE entity_type = 'donor' AND action = 'DONOR_REGISTERED'`
    );
    for (const row of auditRows) {
      const match = /^D-(\d+)$/.exec(row.entity_id);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num >= nextSeq) {
          nextSeq = num + 1;
        }
      }
    }
  } catch (err) {
    // Non-fatal if audit_log is unavailable
  }

  return `D-${String(nextSeq).padStart(6, '0')}`;
}

/**
 * Inserts a new donor record into MySQL using a transaction to guarantee atomic, race-free donor_code generation.
 * Also provisions a linked user portal account with default password DDMMYYYY derived from date of birth.
 * @param {object} donor
 * @returns {Promise<object>}
 */
async function createDonor(donor) {
  const {
    donorCode = null,
    fullName,
    dateOfBirth,
    gender,
    bloodGroup = null,
    phone,
    email = null,
    address = null,
    idProof,
    medicalHistory = null,
    eligibilityStatus = 'PENDING',
    consentGiven = false,
    consentAt = null,
  } = donor;

  const validBloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const sanitizedBloodGroup = validBloodGroups.includes(bloodGroup) ? bloodGroup : null;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const storedAddress = address ? encrypt(address) : null;
    const storedMedicalHistory = medicalHistory ? encrypt(medicalHistory) : null;

    const [result] = await connection.query(
      `INSERT INTO donors (
        donor_code, full_name, date_of_birth, gender, blood_group, phone, email,
        address, id_proof, medical_history, eligibility_status,
        consent_given, consent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        donorCode,
        fullName,
        dateOfBirth,
        gender,
        sanitizedBloodGroup,
        phone,
        email,
        storedAddress,
        idProof,
        storedMedicalHistory,
        eligibilityStatus,
        consentGiven,
        consentAt,
      ]
    );

    const insertId = result.insertId;
    let finalDonorCode = donorCode;

    if (!finalDonorCode) {
      await connection.query(
        "UPDATE donors SET donor_code = CONCAT('D-', LPAD(id, 6, '0')) WHERE id = ?",
        [insertId]
      );
      finalDonorCode = `D-${String(insertId).padStart(6, '0')}`;
    }

    // Automatically provision online portal account for the donor
    let portalUser = null;
    try {
      const defaultPassword = deriveDobPassword(dateOfBirth);
      const passwordHash = await bcrypt.hash(defaultPassword, 10);
      let userEmail = (email || '').trim().toLowerCase();
      if (!userEmail) {
        userEmail = `${finalDonorCode.toLowerCase()}@donor.bbms.test`;
      }

      // Check if user already exists with this email
      const [existingUsers] = await connection.query('SELECT id FROM users WHERE email = ?', [userEmail]);
      let userId;
      if (existingUsers.length > 0) {
        userId = existingUsers[0].id;
      } else {
        const [userResult] = await connection.query(
          'INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES (?, ?, ?, ?, ?)',
          [userEmail, passwordHash, fullName, 'DONOR', true]
        );
        userId = userResult.insertId;
      }

      await connection.query('UPDATE donors SET user_id = ? WHERE id = ?', [userId, insertId]);

      portalUser = {
        email: userEmail,
        defaultPasswordFormat: 'DDMMYYYY',
        defaultPasswordHint: 'Your Date of Birth (DDMMYYYY)',
      };
    } catch (userErr) {
      // Non-fatal if portal user creation encounters an issue
    }

    // Permanently audit registration
    try {
      await connection.query(
        `INSERT INTO audit_log (action, entity_type, entity_id, details)
         VALUES ('DONOR_REGISTERED', 'donor', ?, ?)`,
        [finalDonorCode, JSON.stringify({ fullName, idProof, insertId, consentGiven })]
      );
    } catch (err) {
      // Non-fatal if audit log fails
    }

    await connection.commit();

    return {
      id: insertId,
      donorCode: finalDonorCode,
      eligibilityStatus,
      portalUser,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Deletes a donor record (used for verifying ID non-reuse after deletion).
 * @param {number|string} idOrCode
 * @returns {Promise<boolean>}
 */
async function deleteDonor(idOrCode) {
  const isNumeric = /^\d+$/.test(String(idOrCode));
  const query = isNumeric
    ? 'DELETE FROM donors WHERE id = ?'
    : 'DELETE FROM donors WHERE donor_code = ?';
  const [result] = await db.query(query, [idOrCode]);
  return result.affectedRows > 0;
}

module.exports = {
  deriveDobPassword,
  findByIdProof,
  findById,
  findByIdOrCode,
  findByIdOrCodeOrPhone,
  findByUserId,
  findDonationsByDonorId,
  findLastDonation,
  updateEligibility,
  updateConsent,
  generateNextDonorCode,
  createDonor,
  deleteDonor,
};
