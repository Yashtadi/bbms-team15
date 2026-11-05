const db = require('../../db');

/**
 * SR-002: Finds a user by email for login. Returns null if not found.
 */
async function findUserByEmail(email) {
  const [rows] = await db.query(
    'SELECT id, email, password_hash, full_name, role, is_active FROM users WHERE email = ?',
    [email]
  );
  return rows[0] || null;
}

/**
 * Finds a user by their donor code (e.g. D-000001) or phone number.
 * Allows donors to log in with their permanent donor ID.
 */
async function findUserByDonorCodeOrPhone(identifier) {
  const trimmed = String(identifier).trim();
  const [rows] = await db.query(
    `SELECT u.id, u.email, u.password_hash, u.full_name, u.role, u.is_active
     FROM users u
     JOIN donors d ON d.user_id = u.id
     WHERE d.donor_code = ? OR d.phone = ?
     LIMIT 1`,
    [trimmed, trimmed]
  );
  return rows[0] || null;
}

/**
 * Finds a user by their numeric user ID.
 */
async function findUserById(id) {
  const [rows] = await db.query(
    'SELECT id, email, password_hash, full_name, role, is_active FROM users WHERE id = ?',
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

module.exports = {
  findUserByEmail,
  findUserByDonorCodeOrPhone,
  findUserById,
  updatePassword,
};
