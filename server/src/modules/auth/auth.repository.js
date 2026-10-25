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

module.exports = { findUserByEmail };
