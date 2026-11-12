const bcrypt = require('bcryptjs');
const db = require('../../db');
const { deriveDobPassword } = require('../donor/donor.repository');

/**
 * SR-002: Finds a user by email for login. Returns null if not found.
 */
async function findUserByEmail(email) {
  const [rows] = await db.query(
    'SELECT id, email, password_hash, full_name, role, is_active, mfa_secret, mfa_enabled FROM users WHERE email = ?',
    [email]
  );
  return rows[0] || null;
}

/**
 * Finds a user by their donor code (e.g. D-000001) or phone number.
 * Allows donors to log in with their permanent donor ID.
 * Auto-provisions and links user account if donor exists but user_id was unlinked.
 */
async function findUserByDonorCodeOrPhone(identifier) {
  const trimmed = String(identifier).trim();
  // 1. Try finding linked user via donor_code, phone, or email
  const [rows] = await db.query(
    `SELECT u.id, u.email, u.password_hash, u.full_name, u.role, u.is_active, u.mfa_secret, u.mfa_enabled
     FROM users u
     JOIN donors d ON d.user_id = u.id
     WHERE UPPER(d.donor_code) = UPPER(?) OR d.phone = ? OR UPPER(u.email) = UPPER(?)
     LIMIT 1`,
    [trimmed, trimmed, trimmed]
  );
  if (rows[0]) return rows[0];

  // 2. Fallback: Donor exists in donors table but user_id is NULL or unlinked
  const [donorRows] = await db.query(
    'SELECT * FROM donors WHERE UPPER(donor_code) = UPPER(?) OR phone = ? LIMIT 1',
    [trimmed, trimmed]
  );
  const donor = donorRows[0];
  if (!donor) return null;

  // If donor has user_id but join didn't find active user
  if (donor.user_id) {
    const [userRows] = await db.query(
      'SELECT id, email, password_hash, full_name, role, is_active, mfa_secret, mfa_enabled FROM users WHERE id = ?',
      [donor.user_id]
    );
    if (userRows[0]) return userRows[0];
  }

  // Provision user account on-demand for existing donor
  const donorCode = donor.donor_code || `D-${String(donor.id).padStart(6, '0')}`;
  const defaultPassword = deriveDobPassword(donor.date_of_birth);
  const passwordHash = await bcrypt.hash(defaultPassword, 10);
  const userEmail = (donor.email || `${donorCode.toLowerCase()}@donor.bbms.test`).trim().toLowerCase();

  // Check if a user with this email already exists
  const [existingUserRows] = await db.query(
    'SELECT id, email, password_hash, full_name, role, is_active, mfa_secret, mfa_enabled FROM users WHERE email = ?',
    [userEmail]
  );
  let user;
  if (existingUserRows[0]) {
    user = existingUserRows[0];
  } else {
    const [insertResult] = await db.query(
      'INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES (?, ?, ?, ?, ?)',
      [userEmail, passwordHash, donor.full_name, 'DONOR', true]
    );
    user = {
      id: insertResult.insertId,
      email: userEmail,
      password_hash: passwordHash,
      full_name: donor.full_name,
      role: 'DONOR',
      is_active: true,
      mfa_secret: null,
      mfa_enabled: false,
    };
  }

  await db.query('UPDATE donors SET user_id = ? WHERE id = ?', [user.id, donor.id]);
  return user;
}

/**
 * Finds a user by their numeric user ID.
 */
async function findUserById(id) {
  const [rows] = await db.query(
    'SELECT id, email, password_hash, full_name, role, is_active, mfa_secret, mfa_enabled FROM users WHERE id = ?',
    [id]
  );
  return rows[0] || null;
}

/**
 * Updates a user's password hash.
 */
async function updatePassword(id, passwordHash) {
  const [result] = await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  return result.affectedRows > 0;
}

async function updateMfaSecret(id, encryptedSecret) {
  const [result] = await db.query('UPDATE users SET mfa_secret = ?, mfa_enabled = FALSE WHERE id = ?', [
    encryptedSecret,
    id,
  ]);
  return result.affectedRows > 0;
}

async function enableMfa(id) {
  const [result] = await db.query(
    'UPDATE users SET mfa_enabled = TRUE WHERE id = ? AND mfa_secret IS NOT NULL',
    [id]
  );
  return result.affectedRows > 0;
}

module.exports = {
  findUserByEmail,
  findUserByDonorCodeOrPhone,
  findUserById,
  updatePassword,
  updateMfaSecret,
  enableMfa,
};
