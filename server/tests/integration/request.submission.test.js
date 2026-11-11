const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');

describe('TC-Req-01: Hospital Blood Request Submission & Management (Integration)', () => {
  afterAll(async () => {
    await db.end();
  });

  const uniquePatientName = `Patient Test ${Date.now()}`;
  const validRequest = {
    patientName: uniquePatientName,
    patientBloodGroup: 'AB-',
    component: 'PLATELETS',
    unitsRequested: 2,
    priority: 'URGENT',
    requiredBy: new Date(Date.now() + 86400000).toISOString(),
  };

  let createdRequestCode = null;

  it('submits a blood request as HOSPITAL role, assigns unique Request ID and PENDING status (201)', async () => {
    const res = await request(app)
      .post('/api/blood-requests')
      .set(authHeader('HOSPITAL'))
      .send(validRequest);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('requestCode');
    expect(res.body.requestCode).toMatch(/^R-\d{6}$/);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.patientName).toBe(uniquePatientName);
    expect(res.body.patientBloodGroup).toBe('AB-');
    expect(res.body.component).toBe('PLATELETS');
    expect(res.body.unitsRequested).toBe(2);
    expect(res.body.priority).toBe('URGENT');
    expect(res.body.hospital).toMatchObject({
      id: 5,
      fullName: 'City Hospital Desk',
      organisation: 'City General Hospital',
    });

    createdRequestCode = res.body.requestCode;

    // Verify persisted record in MySQL blood_requests table
    const [rows] = await db.query('SELECT * FROM blood_requests WHERE request_code = ?', [createdRequestCode]);
    expect(rows).toHaveLength(1);
    expect(rows[0].patient_name).toBe(uniquePatientName);
    expect(rows[0].patient_blood_group).toBe('AB-');
    expect(rows[0].component).toBe('PLATELETS');
    expect(rows[0].units_requested).toBe(2);
    expect(rows[0].priority).toBe('URGENT');
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].hospital_user_id).toBe(5);

    // Verify audit log row
    const [auditRows] = await db.query(
      "SELECT * FROM audit_log WHERE entity_type = 'blood_request' AND entity_id = ? AND action = 'REQUEST_SUBMITTED'",
      [createdRequestCode]
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].user_id).toBe(5);
  });

  it('lists hospital requests filtered to the authenticated hospital desk (200)', async () => {
    const res = await request(app)
      .get('/api/blood-requests')
      .set(authHeader('HOSPITAL'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('requests');
    expect(Array.isArray(res.body.requests)).toBe(true);
    expect(res.body.requests.length).toBeGreaterThanOrEqual(1);

    const found = res.body.requests.find((r) => r.requestCode === createdRequestCode);
    expect(found).toBeDefined();
    expect(found.patientName).toBe(uniquePatientName);

    // Every request in the list belongs to user 5 (City Hospital Desk)
    res.body.requests.forEach((r) => {
      expect(r.hospitalUserId).toBe(5);
    });
  });

  it('allows looking up a single blood request by request code (200)', async () => {
    const res = await request(app)
      .get(`/api/blood-requests/${createdRequestCode}`)
      .set(authHeader('HOSPITAL'));

    expect(res.status).toBe(200);
    expect(res.body.request.requestCode).toBe(createdRequestCode);
    expect(res.body.request.patientName).toBe(uniquePatientName);
  });

  it('rejects submission with missing fields (400)', async () => {
    const res = await request(app)
      .post('/api/blood-requests')
      .set(authHeader('HOSPITAL'))
      .send({ patientName: '' });

    expect(res.status).toBe(400);
    expect(res.body.errors.patientName).toBeDefined();
    expect(res.body.errors.patientBloodGroup).toBeDefined();
    expect(res.body.errors.component).toBeDefined();
    expect(res.body.errors.unitsRequested).toBeDefined();
  });

  it('blocks non-hospital roles like LAB_TECH from creating requests (403)', async () => {
    const res = await request(app)
      .post('/api/blood-requests')
      .set(authHeader('LAB_TECH'))
      .send(validRequest);

    expect(res.status).toBe(403);
  });

  it('blocks unauthenticated requests without a token (401)', async () => {
    const res = await request(app)
      .post('/api/blood-requests')
      .send(validRequest);

    expect(res.status).toBe(401);
  });
});
