const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96-bit standard IV for GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128-bit authentication tag
const PREFIX = 'enc:v1';

/**
 * BBMS-SR-003: Resolves a 256-bit (32 bytes) encryption key.
 * Can be provided via ENCRYPTION_KEY or derived from JWT_SECRET or fallback seed.
 * @param {string|Buffer} [customKey]
 * @returns {Buffer} 32-byte Buffer
 */
function getEncryptionKey(customKey = null) {
  const rawKey = customKey || process.env.ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY;
  if (rawKey) {
    if (Buffer.isBuffer(rawKey) && rawKey.length === 32) {
      return rawKey;
    }
    const str = String(rawKey).trim();
    if (/^[0-9a-fA-F]{64}$/.test(str)) {
      return Buffer.from(str, 'hex');
    }
    return crypto.createHash('sha256').update(str).digest();
  }

  // Fallback: derive 32-byte key from JWT_SECRET or default system secret
  const fallbackSource = process.env.JWT_SECRET || 'bbms-default-aes-256-encryption-salt-2026';
  return crypto.createHash('sha256').update(fallbackSource).digest();
}

/**
 * Checks whether a value is an encrypted ciphertext string formatted by this module.
 * @param {any} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
}

/**
 * BBMS-SR-003: Encrypts sensitive personal or medical data using AES-256-GCM.
 * Output format: enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 *
 * @param {string|null|undefined} plaintext
 * @param {Buffer|string} [customKey]
 * @returns {string|null|undefined}
 */
function encrypt(plaintext, customKey = null) {
  if (plaintext === null || plaintext === undefined) {
    return plaintext;
  }

  const text = String(plaintext);
  if (!text) return text;

  // Avoid re-encrypting already encrypted ciphertext
  if (isEncrypted(text)) {
    return text;
  }

  const key = getEncryptionKey(customKey);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * BBMS-SR-003: Decrypts an AES-256-GCM encrypted ciphertext back to plaintext.
 * If the input is not encrypted (e.g. legacy database rows), it is returned as-is.
 *
 * @param {string|null|undefined} ciphertext
 * @param {Buffer|string} [customKey]
 * @returns {string|null|undefined}
 */
function decrypt(ciphertext, customKey = null) {
  if (ciphertext === null || ciphertext === undefined) {
    return ciphertext;
  }

  if (typeof ciphertext !== 'string' || !isEncrypted(ciphertext)) {
    return ciphertext;
  }

  const parts = ciphertext.split(':');
  // Format: enc:v1:<iv>:<tag>:<ciphertext>
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    return ciphertext;
  }

  const [, , ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encryptedData = Buffer.from(dataHex, 'hex');

  if (iv.length !== IV_LENGTH_BYTES || authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Malformed ciphertext: invalid IV or auth tag length');
  }

  const key = getEncryptionKey(customKey);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    const authError = new Error('Authentication tag verification failed: data has been tampered with or corrupted');
    authError.code = 'ERR_CRYPTO_AUTH_FAILED';
    throw authError;
  }
}

/**
 * Decrypts sensitive donor fields in-place on a database row or model object.
 * @param {object} donor
 * @returns {object}
 */
function decryptDonorRow(donor) {
  if (!donor || typeof donor !== 'object') return donor;
  const decrypted = { ...donor };

  if (decrypted.medical_history !== undefined) {
    decrypted.medical_history = decrypt(decrypted.medical_history);
  }
  if (decrypted.medicalHistory !== undefined) {
    decrypted.medicalHistory = decrypt(decrypted.medicalHistory);
  }
  if (decrypted.address !== undefined) {
    decrypted.address = decrypt(decrypted.address);
  }
  if (decrypted.deferral_reason !== undefined) {
    decrypted.deferral_reason = decrypt(decrypted.deferral_reason);
  }
  if (decrypted.deferralReason !== undefined) {
    decrypted.deferralReason = decrypt(decrypted.deferralReason);
  }
  if (decrypted.follow_up_reason !== undefined) {
    decrypted.follow_up_reason = decrypt(decrypted.follow_up_reason);
  }
  if (decrypted.followUpReason !== undefined) {
    decrypted.followUpReason = decrypt(decrypted.followUpReason);
  }

  return decrypted;
}

module.exports = {
  ALGORITHM,
  PREFIX,
  getEncryptionKey,
  isEncrypted,
  encrypt,
  decrypt,
  decryptDonorRow,
};
