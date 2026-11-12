const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');
const { isEncrypted } = require('../../src/utils/encryption');

describe('TC-Sec-03: BBMS-SR-003 AES-256 Encryption at Rest (Integration)', () => {
  let createdDonorCode = null;
  let createdDonorId = null;

  const testMedicalHistory = 'Severe penicillin allergy; Chronic migraine medications; Prior knee surgery 2022';
  const testAddress = 'Flat 502, Palm Meadows, Whitefield, Bengaluru 560066';
  const uniqueIdProof = `ENCR-ID-${Date.now()}`;

  afterAll(async () => {
    try {
      if (createdDonorId) {
        await db.query('DELETE FROM donors WHERE id = ?', [createdDonorId]);
        await db.query('DELETE FROM users WHERE email LIKE ?', [`%${createdDonorCode.toLowerCase()}%`]);
        await db.query('DELETE FROM audit_log WHERE entity_type = "donor" AND entity_id = ?', [createdDonorCode]);
      }
    } finally {
      await db.end();
    }
  });

  it('stores personal and medical data in encrypted ciphertext at rest in MySQL (AES-256-GCM)', async () => {
    // 1. Register donor with sensitive medical history and address
    const regRes = await request(app)
      .post('/api/donors')
      .set(authHeader('LAB_TECH'))
      .send({
        name: 'Suresh Encrypted Patient',
        age: 32,
        gender: 'MALE',
        contact: '9888877777',
        idProof: uniqueIdProof,
        medicalHistory: testMedicalHistory,
        address: testAddress,
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body).toHaveProperty('donorId');
    createdDonorCode = regRes.body.donorId;

    // 2. Query MySQL database directly to inspect data stored at rest on disk
    const [rawRows] = await db.query(
      'SELECT id, donor_code, medical_history, address FROM donors WHERE donor_code = ?',
      [createdDonorCode]
    );

    expect(rawRows).toHaveLength(1);
    createdDonorId = rawRows[0].id;

    const rawMedicalHistory = rawRows[0].medical_history;
    const rawAddress = rawRows[0].address;

    // Verify medical data is encrypted at rest in MySQL using AES-256-GCM (enc:v1:...)
    expect(isEncrypted(rawMedicalHistory)).toBe(true);
    expect(rawMedicalHistory).toMatch(/^enc:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    // Plaintext medical sensitive keywords must never appear in raw database storage
    expect(rawMedicalHistory).not.toContain('penicillin');
    expect(rawMedicalHistory).not.toContain('migraine');
    expect(rawMedicalHistory).not.toContain('surgery');

    // Verify personal address is encrypted at rest in MySQL
    expect(isEncrypted(rawAddress)).toBe(true);
    expect(rawAddress).not.toContain('Meadows');
    expect(rawAddress).not.toContain('Whitefield');
  });

  it('transparently decrypts personal and medical data when queried via authorized API endpoints', async () => {
    // Retrieve registered donor via GET /api/donors/:query
    const getRes = await request(app)
      .get(`/api/donors/${createdDonorCode}`)
      .set(authHeader('LAB_TECH'));

    expect(getRes.status).toBe(200);
    expect(getRes.body.donorId).toBe(createdDonorCode);

    // The authorized API endpoint returns transparently decrypted plaintext for clinical use
    expect(getRes.body.medicalHistory).toBe(testMedicalHistory);
  });

  it('encrypts clinical deferral reasons at rest in MySQL when evaluating donor eligibility', async () => {
    const deferralReason = 'Hemoglobin 11.2 g/dL below safety threshold (12.5 g/dL)';

    // Evaluate eligibility with low hemoglobin (422 Deferral)
    const deferRes = await request(app)
      .post(`/api/donors/${createdDonorCode}/eligibility`)
      .set(authHeader('LAB_TECH'))
      .send({ hemoglobin: 11.2, weight: 65 });

    expect(deferRes.status).toBe(422);

    // Verify deferral reason in raw MySQL database row is encrypted at rest
    const [rawRows] = await db.query(
      'SELECT deferral_reason, eligibility_status FROM donors WHERE donor_code = ?',
      [createdDonorCode]
    );

    expect(rawRows[0].eligibility_status).toBe('DEFERRED');
    expect(isEncrypted(rawRows[0].deferral_reason)).toBe(true);
    expect(rawRows[0].deferral_reason).not.toContain('Hemoglobin');

    // Verify query via API returns decrypted reason
    const checkRes = await request(app)
      .get(`/api/donors/${createdDonorCode}`)
      .set(authHeader('LAB_TECH'));

    expect(checkRes.status).toBe(200);
    expect(checkRes.body.deferralReason).toMatch(/Haemoglobin must be at least 12.5 g\/dL/i);
  });

  it('transparently reads legacy unencrypted seed donors without error', async () => {
    // D-000001 in seed data has unencrypted medical_history = 'None'
    const res = await request(app)
      .get('/api/donors/D-000001')
      .set(authHeader('LAB_TECH'));

    expect(res.status).toBe(200);
    expect(res.body.medicalHistory).toBe('None');
  });
});
