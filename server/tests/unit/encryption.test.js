const {
  ALGORITHM,
  PREFIX,
  getEncryptionKey,
  isEncrypted,
  encrypt,
  decrypt,
  decryptDonorRow,
} = require('../../src/utils/encryption');

describe('TC-Sec-03: BBMS-SR-003 AES-256 Encryption at Rest (Unit)', () => {
  const sampleMedicalData = 'Chronic hypertension; Penicillin anaphylaxis allergy; Appendectomy in 2018';
  const samplePersonalData = 'Flat 402, Sunrise Heights, 12th Main, Indiranagar, Bangalore 560038';

  describe('Core Cryptographic Functions (AES-256-GCM)', () => {
    it('uses the approved AES-256-GCM encryption standard', () => {
      expect(ALGORITHM).toBe('aes-256-gcm');
      expect(PREFIX).toBe('enc:v1');
    });

    it('resolves a valid 256-bit (32 bytes) encryption key', () => {
      const key = getEncryptionKey();
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32); // 32 bytes = 256 bits
    });

    it('accepts a 64-char hex key or derives 32 bytes from passphrase', () => {
      const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const keyFromHex = getEncryptionKey(hexKey);
      expect(keyFromHex.length).toBe(32);
      expect(keyFromHex.toString('hex')).toBe(hexKey);

      const passphraseKey = getEncryptionKey('my-secure-hospital-passphrase-2026');
      expect(passphraseKey.length).toBe(32);
    });

    it('encrypts medical data into ciphertext that does not expose plaintext', () => {
      const ciphertext = encrypt(sampleMedicalData);
      expect(isEncrypted(ciphertext)).toBe(true);
      expect(ciphertext).toMatch(/^enc:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
      expect(ciphertext).not.toContain('hypertension');
      expect(ciphertext).not.toContain('Penicillin');
      expect(ciphertext).not.toContain('Appendectomy');
    });

    it('encrypts personal data into ciphertext that does not expose plaintext', () => {
      const ciphertext = encrypt(samplePersonalData);
      expect(isEncrypted(ciphertext)).toBe(true);
      expect(ciphertext).not.toContain('Sunrise');
      expect(ciphertext).not.toContain('Bangalore');
    });

    it('decrypts encrypted medical and personal data back to original plaintext', () => {
      const encryptedMedical = encrypt(sampleMedicalData);
      const decryptedMedical = decrypt(encryptedMedical);
      expect(decryptedMedical).toBe(sampleMedicalData);

      const encryptedPersonal = encrypt(samplePersonalData);
      const decryptedPersonal = decrypt(encryptedPersonal);
      expect(decryptedPersonal).toBe(samplePersonalData);
    });

    it('produces different ciphertexts for identical plaintext due to random IVs (semantic security)', () => {
      const ct1 = encrypt(sampleMedicalData);
      const ct2 = encrypt(sampleMedicalData);
      expect(ct1).not.toBe(ct2);

      // Both decrypt to the same original text
      expect(decrypt(ct1)).toBe(sampleMedicalData);
      expect(decrypt(ct2)).toBe(sampleMedicalData);
    });

    it('fails decryption when ciphertext has been tampered with (authenticity guarantee)', () => {
      const ciphertext = encrypt(sampleMedicalData);
      const parts = ciphertext.split(':');
      // Flip the last character of ciphertext payload
      const tamperedPayload = parts[4].slice(0, -1) + (parts[4].endsWith('a') ? 'b' : 'a');
      const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:${tamperedPayload}`;

      expect(() => decrypt(tampered)).toThrow(/tampered with or corrupted/i);
    });

    it('fails decryption when authentication tag has been tampered with', () => {
      const ciphertext = encrypt(sampleMedicalData);
      const parts = ciphertext.split(':');
      const tamperedTag = '0'.repeat(32);
      const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedTag}:${parts[4]}`;

      expect(() => decrypt(tampered)).toThrow(/tampered with or corrupted/i);
    });

    it('handles null and undefined gracefully', () => {
      expect(encrypt(null)).toBeNull();
      expect(encrypt(undefined)).toBeUndefined();
      expect(decrypt(null)).toBeNull();
      expect(decrypt(undefined)).toBeUndefined();
    });

    it('returns plaintext as-is when input is not encrypted (backward compatibility with legacy data)', () => {
      const legacyPlainText = 'None reported';
      expect(decrypt(legacyPlainText)).toBe(legacyPlainText);
    });

    it('avoids double-encrypting already encrypted ciphertext', () => {
      const once = encrypt(sampleMedicalData);
      const twice = encrypt(once);
      expect(twice).toBe(once);
    });
  });

  describe('decryptDonorRow helper', () => {
    it('decrypts medical_history, address, and deferral_reason in a database row', () => {
      const row = {
        id: 1,
        donor_code: 'D-000001',
        full_name: 'Anjali Sharma',
        medical_history: encrypt('Asthma inhaler as needed'),
        address: encrypt('B-101, Whitefield, Bengaluru'),
        deferral_reason: encrypt('Recent dental surgery'),
      };

      const decrypted = decryptDonorRow(row);
      expect(decrypted.medical_history).toBe('Asthma inhaler as needed');
      expect(decrypted.address).toBe('B-101, Whitefield, Bengaluru');
      expect(decrypted.deferral_reason).toBe('Recent dental surgery');
      expect(decrypted.full_name).toBe('Anjali Sharma');
    });

    it('leaves unencrypted legacy fields intact', () => {
      const row = {
        id: 2,
        donor_code: 'D-000002',
        medical_history: 'None',
        address: 'MG Road, Delhi',
      };

      const decrypted = decryptDonorRow(row);
      expect(decrypted.medical_history).toBe('None');
      expect(decrypted.address).toBe('MG Road, Delhi');
    });
  });
});
