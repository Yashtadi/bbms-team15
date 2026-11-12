const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const repository = require('./auth.repository');
const { encrypt, decrypt } = require('../../utils/encryption');
const { generateSecret, verifyTotp, getOtpAuthUrl } = require('./mfa.totp');

const TOKEN_EXPIRES_IN = '8h';
const MFA_CHALLENGE_EXPIRES_IN = '5m';
const MFA_SETUP_EXPIRES_IN = '10m';
const MFA_ROLES = ['ADMIN', 'MANAGER'];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function publicUser(user) {
  return { id: user.id, email: user.email, fullName: user.full_name, role: user.role };
}

function signToken(user, claims = {}, expiresIn = TOKEN_EXPIRES_IN) {
  return jwt.sign({ sub: user.id, role: user.role, ...claims }, process.env.JWT_SECRET, { expiresIn });
}

function verifyStepToken(token, purpose) {
  if (typeof token !== 'string' || !token.trim()) throw httpError(401, 'A valid MFA token is required');
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw httpError(401, 'MFA token is invalid or expired');
  }
  if (payload.purpose !== purpose || !payload.sub || !MFA_ROLES.includes(payload.role)) {
    throw httpError(401, 'MFA token is invalid or expired');
  }
  return payload;
}

async function findPrivilegedUser(token, purpose) {
  const payload = verifyStepToken(token, purpose);
  const user = await repository.findUserById(payload.sub);
  if (!user || !user.is_active || user.role !== payload.role || !MFA_ROLES.includes(user.role)) {
    throw httpError(401, 'MFA token is invalid or expired');
  }
  return user;
}

function issueSession(user) {
  return { token: signToken(user), user: publicUser(user) };
}

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

  if (MFA_ROLES.includes(user.role)) {
    const enabled = user.mfa_enabled === true || Number(user.mfa_enabled) === 1;
    if (!enabled) {
      return {
        mfaSetupRequired: true,
        setupToken: signToken(user, { purpose: 'mfa_setup' }, MFA_SETUP_EXPIRES_IN),
        user: publicUser(user),
      };
    }
    return {
      mfaRequired: true,
      challengeToken: signToken(user, { purpose: 'mfa_challenge' }, MFA_CHALLENGE_EXPIRES_IN),
      user: publicUser(user),
    };
  }

  return issueSession(user);
}

async function beginMfaSetup({ setupToken } = {}) {
  const user = await findPrivilegedUser(setupToken, 'mfa_setup');
  if (await repository.isMfaLocked(user.id)) throw httpError(429, 'Too many invalid authenticator codes; try again later');
  if (user.mfa_enabled === true || Number(user.mfa_enabled) === 1) {
    throw httpError(409, 'Multi-factor authentication is already enabled');
  }
  const secret = generateSecret();
  const saved = await repository.updateMfaSecret(user.id, encrypt(secret));
  if (!saved) throw httpError(404, 'User not found');
  return { secret, otpauthUrl: getOtpAuthUrl(secret, user.email) };
}

async function verifyMfaSetup({ setupToken, code } = {}) {
  const user = await findPrivilegedUser(setupToken, 'mfa_setup');
  if (await repository.isMfaLocked(user.id)) throw httpError(429, 'Too many invalid authenticator codes; try again later');
  if (!user.mfa_secret) throw httpError(409, 'Start multi-factor setup before verifying a code');
  if (!verifyTotp(decrypt(user.mfa_secret), code)) {
    const locked = await repository.recordMfaFailure(user.id);
    throw httpError(locked ? 429 : 401, locked
      ? 'Too many invalid authenticator codes; try again later'
      : 'Invalid authenticator code');
  }
  const enabled = await repository.enableMfa(user.id);
  if (!enabled) throw httpError(409, 'Could not enable multi-factor authentication');
  return issueSession(user);
}

async function verifyMfa({ challengeToken, code } = {}) {
  const user = await findPrivilegedUser(challengeToken, 'mfa_challenge');
  if (await repository.isMfaLocked(user.id)) throw httpError(429, 'Too many invalid authenticator codes; try again later');
  if (user.mfa_enabled !== true && Number(user.mfa_enabled) !== 1) {
    throw httpError(401, 'Multi-factor authentication is not enabled for this account');
  }
  if (!user.mfa_secret || !verifyTotp(decrypt(user.mfa_secret), code)) {
    const locked = await repository.recordMfaFailure(user.id);
    throw httpError(locked ? 429 : 401, locked
      ? 'Too many invalid authenticator codes; try again later'
      : 'Invalid authenticator code');
  }
  await repository.clearMfaFailures(user.id);
  return issueSession(user);
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

module.exports = { login, beginMfaSetup, verifyMfaSetup, verifyMfa, changePassword };
