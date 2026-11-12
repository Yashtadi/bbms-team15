const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >>> bits) & 31];
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(secret) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of String(secret).toUpperCase().replace(/=+$/g, '')) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 MFA secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return encodeBase32(crypto.randomBytes(20));
}

function generateTotp(secret, time = Date.now()) {
  const counter = Math.floor(time / 1000 / STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255);
  return String(binary % 1000000).padStart(6, '0');
}

function verifyTotp(secret, code, time = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const supplied = Buffer.from(code);
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(generateTotp(secret, time + offset * STEP_SECONDS * 1000));
    if (crypto.timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}

function getOtpAuthUrl(secret, account, issuer = 'BBMS Team 15') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${query.toString()}`;
}

module.exports = { generateSecret, generateTotp, verifyTotp, getOtpAuthUrl };
