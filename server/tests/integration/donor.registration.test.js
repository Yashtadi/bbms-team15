const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');

describe('TC-Reg-01: POST /api/donors (integration)', () => {
  afterAll(async () => {
    await db.end();
  });

  const uniqueIdProof = `TEST-ID-${Date.now()}`;
  const validPayload = {
    name: 'Integration Test Donor',
    age: 26,
    gender: 'MALE',
    contact: '9988776655',
    idProof: uniqueIdProof,
    medicalHistory: 'None reported',
  };

  it('creates a new donor in database and returns 201 { donorId, status }', async () => {
    const res = await request(app)
      .post('/api/donors')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('donorId');
    expect(res.body.donorId).toMatch(/^D-\d{6}$/);
    expect(res.body.status).toBe('PENDING');

    // Verify row actually exists in MySQL
    const [rows] = await db.query('SELECT * FROM donors WHERE id_proof = ?', [uniqueIdProof]);
    expect(rows.length).toBe(1);
    expect(rows[0].full_name).toBe('Integration Test Donor');
    expect(rows[0].donor_code).toBe(res.body.donorId);
  });

  it('rejects registering twice with the same ID proof with 409 Conflict', async () => {
    const res = await request(app)
      .post('/api/donors')
      .send(validPayload);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('already registered');
  });

  it('returns 400 with field-level error messages on invalid input', async () => {
    const res = await request(app)
      .post('/api/donors')
      .send({
        name: '',
        age: 15,
        gender: 'INVALID_GENDER',
        contact: 'short',
        idProof: '',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors).toHaveProperty('name', 'Full name is required');
    expect(res.body.errors).toHaveProperty('age', 'Age must be between 18 and 65');
    expect(res.body.errors).toHaveProperty('gender', 'Gender must be MALE, FEMALE, or OTHER');
    expect(res.body.errors).toHaveProperty('contact', 'Invalid contact number');
    expect(res.body.errors).toHaveProperty('idProof', 'ID proof is required');
  });
});
