const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { deleteDonor } = require('../../src/modules/donor/donor.repository');
const { authHeader } = require('../helpers/auth');

describe('TC-Reg-03: unique donor ID (integration)', () => {
  afterAll(async () => {
    await db.end();
  });

  it('two consecutive registrations receive two different, human-readable IDs', async () => {
    const timestamp = Date.now();

    // Registration 1
    const res1 = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: 'First Consecutive Donor',
        age: 27,
        gender: 'FEMALE',
        contact: '9111222333',
        idProof: `ID-SEQ-A-${timestamp}`,
      });

    expect(res1.status).toBe(201);
    expect(res1.body).toHaveProperty('donorId');
    const id1 = res1.body.donorId;
    expect(id1).toMatch(/^D-\d{6,}$/);

    // Registration 2
    const res2 = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: 'Second Consecutive Donor',
        age: 32,
        gender: 'MALE',
        contact: '9222333444',
        idProof: `ID-SEQ-B-${timestamp}`,
      });

    expect(res2.status).toBe(201);
    expect(res2.body).toHaveProperty('donorId');
    const id2 = res2.body.donorId;
    expect(id2).toMatch(/^D-\d{6,}$/);

    // Must be two distinct, non-identical IDs
    expect(id1).not.toBe(id2);

    // Sequence numbers must be strictly increasing
    const seq1 = parseInt(id1.replace('D-', ''), 10);
    const seq2 = parseInt(id2.replace('D-', ''), 10);
    expect(seq2).toBeGreaterThan(seq1);
  });

  it('enforces database UNIQUE constraint on donor_code', async () => {
    const duplicateCode = `D-TEST-DUP-${Date.now().toString().slice(-6)}`;

    // First direct insert into MySQL
    await db.query(
      `INSERT INTO donors (donor_code, full_name, date_of_birth, gender, phone, id_proof, eligibility_status)
       VALUES (?, 'Direct Insert Donor', '1995-01-01', 'MALE', '9998887776', ?, 'PENDING')`,
      [duplicateCode, `PROOF-DUP-1-${Date.now()}`]
    );

    // Second insert with the identical donor_code must be rejected by MySQL UNIQUE constraint
    await expect(
      db.query(
        `INSERT INTO donors (donor_code, full_name, date_of_birth, gender, phone, id_proof, eligibility_status)
         VALUES (?, 'Duplicate Donor Code', '1996-01-01', 'FEMALE', '9998887775', ?, 'PENDING')`,
        [duplicateCode, `PROOF-DUP-2-${Date.now()}`]
      )
    ).rejects.toMatchObject({
      code: 'ER_DUP_ENTRY',
    });
  });

  it('never reuses a donor ID even if a donor record is deleted (AC 3)', async () => {
    const timestamp = Date.now();

    // Register a donor
    const res = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: 'Temporary Donor',
        age: 29,
        gender: 'OTHER',
        contact: '9333444555',
        idProof: `ID-TEMP-${timestamp}`,
      });

    expect(res.status).toBe(201);
    const deletedId = res.body.donorId;
    const deletedSeq = parseInt(deletedId.replace('D-', ''), 10);

    // Remove the donor record from the database
    const wasDeleted = await deleteDonor(deletedId);
    expect(wasDeleted).toBe(true);

    // Register the next donor
    const nextRes = await request(app)
      .post('/api/donors').set(authHeader('LAB_TECH'))
      .send({
        name: 'Subsequent Donor',
        age: 30,
        gender: 'FEMALE',
        contact: '9444555666',
        idProof: `ID-NEXT-${timestamp}`,
      });

    expect(nextRes.status).toBe(201);
    const nextId = nextRes.body.donorId;
    const nextSeq = parseInt(nextId.replace('D-', ''), 10);

    // The deleted ID must NEVER be reused; the new sequence must be strictly greater
    expect(nextId).not.toBe(deletedId);
    expect(nextSeq).toBeGreaterThan(deletedSeq);
  });

  it('registers ~5 donors concurrently with Promise.all and assigns 5 distinct IDs (#46)', async () => {
    const timestamp = Date.now();
    const count = 5;

    const registrations = Array.from({ length: count }, (_, i) =>
      request(app)
        .post('/api/donors').set(authHeader('LAB_TECH'))
        .send({
          name: `Concurrent Donor ${i}`,
          age: 25 + i,
          gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
          contact: `980000000${i}`,
          idProof: `ID-PARALLEL-${timestamp}-${i}`,
        })
    );

    const responses = await Promise.all(registrations);

    // All registrations must succeed with 201 Created without race condition errors
    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('donorId');
      expect(res.body.donorId).toMatch(/^D-\d{6,}$/);
    }

    // All generated donor IDs must be strictly unique
    const donorIds = responses.map((r) => r.body.donorId);
    const uniqueIds = new Set(donorIds);
    expect(uniqueIds.size).toBe(count);
  });
});
