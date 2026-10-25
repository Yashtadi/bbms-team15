const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const repository = require('./auth.repository');

const TOKEN_EXPIRES_IN = '8h';

function invalidCredentials() {
  const error = new Error('Invalid email or password');
  error.status = 401;
  return error;
}

/**
 * SR-002: Checks email + password and returns a signed JWT.
 * The token payload holds only the user id (sub) and role. Never put secrets in it.
 */
async function login({ email, password } = {}) {
  if (!email || !password) {
    const error = new Error('Email and password are required');
    error.status = 400;
    throw error;
  }

  const user = await repository.findUserByEmail(String(email).trim().toLowerCase());
  if (!user || !user.is_active) {
    throw invalidCredentials();
  }

  const passwordMatches = await bcrypt.compare(String(password), user.password_hash);
  if (!passwordMatches) {
    throw invalidCredentials();
  }

  const token = jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES_IN }
  );

  return {
    token,
    user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
  };
}

module.exports = { login };
