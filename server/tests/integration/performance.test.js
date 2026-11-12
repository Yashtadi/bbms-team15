const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { authHeader } = require('../helpers/auth');
const { measure, percentile } = require('../helpers/perf');

// TC-Perf-01 (BBMS-NF-001): search and inventory queries return within 2 seconds for 95% of requests.
//
// The suite loads a realistic blood bank on top of the seed data (300 donors and donations,
// 1,200 units in every status, 1,800 lab results, 300 hospital requests), fires
// REQUESTS_PER_ENDPOINT calls at each search/inventory endpoint with CONCURRENCY in flight
// (the "normal load" of one busy blood bank's staff), and asserts each endpoint's p95 is under 2 s.
// Everything it adds is tagged and deleted afterwards, because the database is shared.

jest.setTimeout(180000);

const P95_LIMIT_MS = 2000;
const REQUESTS_PER_ENDPOINT = 100;
const CONCURRENCY = 10;
const WARM_UP_REQUESTS = 10;

const DONORS = 300;
const UNITS_PER_DONATION = 4;
const REQUESTS = 300;
const TAG = 'PERF-TC-Perf-01';
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const COMPONENTS = ['PRBC', 'FFP', 'PLATELETS', 'WHOLE_BLOOD'];
const TTI_TESTS = ['HIV', 'HBV', 'HCV', 'SYPHILIS', 'MALARIA'];

const phoneFor = (i) => `77${String(i).padStart(8, '0')}`;

describe('TC-Perf-01: BBMS-NF-001 search & inventory queries under 2 s (integration)', () => {
  let server;
  let agent;
  let donationIds = [];
  const report = [];

  async function seedLoad() {
    const donorRows = Array.from({ length: DONORS }, (_, i) => [
      `PERF-${String(i).padStart(5, '0')}`, // id_proof (tag)
      `DP-${String(i).padStart(6, '0')}`, // donor_code
      `Perf Donor ${i}`,
      '1990-01-01',
      i % 2 === 0 ? 'MALE' : 'FEMALE',
      GROUPS[i % GROUPS.length],
      phoneFor(i),
      'ELIGIBLE',
      true,
    ]);
    await db.query(
      `INSERT INTO donors (id_proof, donor_code, full_name, date_of_birth, gender, blood_group, phone,
                           eligibility_status, consent_given) VALUES ?`,
      [donorRows]
    );
    const [donors] = await db.query("SELECT id, blood_group FROM donors WHERE id_proof LIKE 'PERF-%' ORDER BY id");

    await db.query(
      `INSERT INTO donations (donor_id, collected_by, collected_at, camp_location, status, volume_ml) VALUES ?`,
      [donors.map((d, i) => [d.id, 3, new Date(Date.now() - (i % 30) * 86400000), TAG, 'COMPLETED', 450])]
    );
    const [donations] = await db.query(
      `SELECT d.id, d.collected_at, dn.blood_group FROM donations d JOIN donors dn ON dn.id = d.donor_id
       WHERE d.camp_location = ? ORDER BY d.id`,
      [TAG]
    );
    donationIds = donations.map((d) => d.id);

    // 5 in 6 donations pass every test; the rest stay untested (quarantine stock)
    const labRows = [];
    donations.forEach((d, i) => {
      if (i % 6 === 5) return;
      labRows.push([d.id, 'ABO_RH', d.blood_group, null, 3, 4, new Date(), 'VERIFIED']);
      TTI_TESTS.forEach((test) => labRows.push([d.id, test, 'NON_REACTIVE', 'ELISA', 3, null, null, 'PENDING']));
    });
    await db.query(
      `INSERT INTO lab_results (donation_id, test_type, result, method, tested_by, verified_by, verified_at,
                                verification_status) VALUES ?`,
      [labRows]
    );

    const unitRows = [];
    donations.forEach((d, i) => {
      const tested = i % 6 !== 5;
      COMPONENTS.slice(0, UNITS_PER_DONATION).forEach((component, c) => {
        const n = i * UNITS_PER_DONATION + c;
        let status = tested ? 'AVAILABLE' : 'QUARANTINE';
        if (tested && n % 10 === 0) status = 'ISSUED';
        if (tested && n % 17 === 0) status = 'EXPIRED';
        unitRows.push([
          `U-2026-8${String(n).padStart(5, '0')}`,
          d.id,
          component,
          tested ? d.blood_group : null,
          component === 'PLATELETS' ? 50 : 250,
          d.collected_at,
          new Date(Date.now() + ((n % 40) + 1) * 86400000),
          status,
        ]);
      });
    });
    await db.query(
      `INSERT INTO blood_units (unit_code, donation_id, component, blood_group, volume_ml, collected_at,
                                expires_at, status) VALUES ?`,
      [unitRows]
    );

    const requestRows = Array.from({ length: REQUESTS }, (_, i) => [
      `R-8${String(i).padStart(5, '0')}`,
      5,
      `Perf Patient ${i}`,
      GROUPS[i % GROUPS.length],
      COMPONENTS[i % 3],
      (i % 4) + 1,
      ['ROUTINE', 'URGENT', 'EMERGENCY'][i % 3],
      i % 5 === 0 ? 'ISSUED' : 'PENDING',
    ]);
    await db.query(
      `INSERT INTO blood_requests (request_code, hospital_user_id, patient_name, patient_blood_group, component,
                                   units_requested, priority, status) VALUES ?`,
      [requestRows]
    );
  }

  async function cleanUp() {
    const [donations] = await db.query('SELECT id FROM donations WHERE camp_location = ?', [TAG]);
    const ids = donations.map((d) => d.id);
    if (ids.length) {
      await db.query('DELETE FROM blood_units WHERE donation_id IN (?)', [ids]);
      await db.query('DELETE FROM lab_results WHERE donation_id IN (?)', [ids]);
      await db.query('DELETE FROM donations WHERE id IN (?)', [ids]);
    }
    await db.query("DELETE FROM donors WHERE id_proof LIKE 'PERF-%'");
    await db.query("DELETE FROM blood_requests WHERE request_code LIKE 'R-8_____' AND patient_name LIKE 'Perf Patient %'");
  }

  beforeAll(async () => {
    await cleanUp();
    await seedLoad();
    // A live database keeps its optimizer statistics current; refresh them after the bulk load
    // so the queries are planned as they would be in production, not against a near-empty table.
    await db.query('ANALYZE TABLE donors, donations, lab_results, blood_units, blood_requests');
    server = app.listen(0);
    agent = request(server);
  });

  afterAll(async () => {
    try {
      // eslint-disable-next-line no-console
      console.log(
        `TC-Perf-01 (${REQUESTS_PER_ENDPOINT} requests per endpoint, ${CONCURRENCY} concurrent)\n` +
          report.map((r) => `  ${r.name.padEnd(48)} p50 ${r.p50.toFixed(0).padStart(5)} ms   p95 ${r.p95.toFixed(0).padStart(5)} ms   max ${r.max.toFixed(0).padStart(5)} ms`).join('\n')
      );
      await cleanUp();
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.end();
    }
  });

  async function expectP95UnderLimit(name, send) {
    const check = (res) => expect(res.status).toBe(200);
    // Unmeasured warm-up: the first calls of a cold endpoint include one-off costs (JIT, buffer pool)
    await measure(send, { total: WARM_UP_REQUESTS, concurrency: CONCURRENCY, check });

    const timings = await measure(send, { total: REQUESTS_PER_ENDPOINT, concurrency: CONCURRENCY, check });
    const p95 = percentile(timings, 95);
    report.push({ name, p50: percentile(timings, 50), p95, max: Math.max(...timings) });
    expect(timings).toHaveLength(REQUESTS_PER_ENDPOINT);
    if (p95 >= P95_LIMIT_MS) {
      throw new Error(`${name}: p95 ${p95.toFixed(0)} ms is not under ${P95_LIMIT_MS} ms (NF-001)`);
    }
  }

  const manager = authHeader('MANAGER');
  const labTech = authHeader('LAB_TECH');

  it('loaded the test dataset', async () => {
    const [[units]] = await db.query('SELECT COUNT(*) AS n FROM blood_units WHERE donation_id IN (?)', [donationIds]);
    expect(Number(units.n)).toBe(DONORS * UNITS_PER_DONATION);
  });

  it('inventory dashboard summary (GET /api/inventory/summary)', async () => {
    await expectP95UnderLimit('GET /api/inventory/summary', () => agent.get('/api/inventory/summary').set(manager));
  });

  it('available unit list (GET /api/inventory)', async () => {
    await expectP95UnderLimit('GET /api/inventory', () => agent.get('/api/inventory').set(manager));
  });

  it('filtered unit search (GET /api/inventory?bloodGroup&component)', async () => {
    let i = 0;
    await expectP95UnderLimit('GET /api/inventory?bloodGroup=..&component=..', () => {
      i += 1;
      return agent
        .get('/api/inventory')
        .query({ bloodGroup: GROUPS[i % GROUPS.length], component: COMPONENTS[i % 3] })
        .set(manager);
    });
  });

  it('FEFO allocation search (GET /api/inventory/fefo)', async () => {
    let i = 0;
    await expectP95UnderLimit('GET /api/inventory/fefo', () => {
      i += 1;
      return agent
        .get('/api/inventory/fefo')
        .query({ patientBloodGroup: GROUPS[i % GROUPS.length], component: 'PRBC', unitsRequested: 4 })
        .set(labTech);
    });
  });

  it('expiry alerts (GET /api/inventory/alerts/expiry)', async () => {
    await expectP95UnderLimit('GET /api/inventory/alerts/expiry', () =>
      agent.get('/api/inventory/alerts/expiry').query({ thresholdDays: 7 }).set(manager)
    );
  });

  it('low-stock alerts (GET /api/inventory/alerts/low-stock)', async () => {
    await expectP95UnderLimit('GET /api/inventory/alerts/low-stock', () =>
      agent.get('/api/inventory/alerts/low-stock').set(manager)
    );
  });

  it('blood request list and filtered search (GET /api/blood-requests)', async () => {
    let i = 0;
    await expectP95UnderLimit('GET /api/blood-requests[?status&priority]', () => {
      i += 1;
      const query = i % 2 === 0 ? { status: 'PENDING', priority: 'EMERGENCY' } : {};
      return agent.get('/api/blood-requests').query(query).set(manager);
    });
  });

  it('donor search by phone and donor ID (GET /api/donors/:query)', async () => {
    let i = 0;
    await expectP95UnderLimit('GET /api/donors/:query', () => {
      i += 1;
      const query = i % 2 === 0 ? phoneFor(i % DONORS) : `DP-${String(i % DONORS).padStart(6, '0')}`;
      return agent.get(`/api/donors/${query}`).set(labTech);
    });
  });

  it('lab testing queue (GET /api/lab/queue)', async () => {
    await expectP95UnderLimit('GET /api/lab/queue', () => agent.get('/api/lab/queue').set(labTech));
  });
});
