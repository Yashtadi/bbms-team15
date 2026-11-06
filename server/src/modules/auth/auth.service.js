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
 * SR-002: Checks email (or Donor ID / phone) + password and returns a signed JWT.
 * The token payload holds only the user id (sub) and role. Never put secrets in it.
 */
async function login({ email, password } = {}) {
  if (!email || !password) {
    const error = new Error('Email and password are required');
    error.status = 400;
    throw error;
  }

  const rawIdentifier = String(email).trim();
  let user = await repository.findUserByEmail(rawIdentifier.toLowerCase());

  // If not found by email, allow login by permanent Donor ID (e.g. D-000001) or phone
  if (!user && typeof repository.findUserByDonorCodeOrPhone === 'function') {
    user = await repository.findUserByDonorCodeOrPhone(rawIdentifier);
  }

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

/**
 * Changes a user's password after verifying their current password.
 */
async function changePassword({ userId, currentPassword, newPassword, confirmPassword } = {}) {
  if (!currentPassword || !newPassword) {
    const error = new Error('Current password and new password are required');
    error.status = 400;
    throw error;
  }

  if (newPassword !== confirmPassword) {
    const error = new Error('New passwords do not match');
    error.status = 400;
    throw error;
  }

  if (String(newPassword).length < 6) {
    const error = new Error('New password must be at least 6 characters long');
    error.status = 400;
    throw error;
  }

  if (newPassword === currentPassword) {
    const error = new Error('New password must be different from current password');
    error.status = 400;
    throw error;
  }

  const user = await repository.findUserById(userId);
  if (!user || !user.is_active) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const passwordMatches = await bcrypt.compare(String(currentPassword), user.password_hash);
  if (!passwordMatches) {
    const error = new Error('Current password is incorrect');
    error.status = 401;
    throw error;
  }

  const newHash = await bcrypt.hash(String(newPassword), 10);
  await repository.updatePassword(userId, newHash);

  return { message: 'Password updated successfully' };
}

module.exports = { login, changePassword };
