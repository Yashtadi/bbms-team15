// Test helper: builds a valid token for a seed user, without calling /login.
//   const { authHeader } = require('../helpers/auth');
//   request(app).post('/api/donors').set(authHeader('LAB_TECH')).send(payload)

const jwt = require('jsonwebtoken');

// User ids from server/db/seed.sql
const SEED_USER_IDS = { ADMIN: 1, MANAGER: 2, LAB_TECH: 3, HOSPITAL: 5, DONOR: 6 };

function tokenFor(role) {
  return jwt.sign({ sub: SEED_USER_IDS[role], role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function authHeaderForUser(id, role) {
  const token = jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

function authHeader(role) {
  return { Authorization: `Bearer ${tokenFor(role)}` };
}

module.exports = { tokenFor, authHeader, authHeaderForUser };
