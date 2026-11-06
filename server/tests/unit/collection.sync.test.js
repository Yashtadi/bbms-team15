const {
  MAX_SYNC_BATCH,
  CLOCK_SKEW_MS,
  normaliseClientRef,
  validateCampRecord,
  syncCampRecords,
} = require('../../src/modules/collection/collection.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-06T10:00:00.000Z');
const STAFF_ID = 7;

const REF_A = '3f2a9c1b-0d4e-4f6a-9b8c-1a2b3c4d5e6f';
const REF_B = '9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e';

const ELIGIBLE_DONOR = {
  id: 11,
  donor_code: 'D-000011',
  date_of_birth: '1995-04-12',
  consent_given: 1,
  eligibility_status: 'ELIGIBLE',
};

function campRecord(overrides = {}) {
  return {
    clientRef: REF_A,
    donorId: 'D-000011',
    campLocation: 'PES University camp',
    collectedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    donationType: 'WHOLE_BLOOD',
    volumeMl: 450,
    vitals: { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, hemoglobinGDl: 13.5 },
    ...overrides,
  };
}

function existingRow(overrides = {}) {
  return {
    donation_id: 40,
    id: 90,
    unit_code: 'U-2026-000090',
    component: 'WHOLE_BLOOD',
    blood_group: null,
    volume_ml: 450,
    collected_at: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    expires_at: new Date(NOW.getTime() + 34 * DAY_MS),
    status: 'QUARANTINE',
    ...overrides,
  };
}

function mockRepos({ donor = ELIGIBLE_DONOR, existing = null, lastDonation = null } = {}) {
  let nextId = 100;
  return {
    donorRepo: { findByIdOrCode: jest.fn().mockResolvedValue(donor) },
    collectionRepo: {
      findSessionByClientRef: jest.fn().mockResolvedValue(existing),
      findLastDonationBefore: jest.fn().mockResolvedValue(lastDonation),
      createSyncedSession: jest.fn().mockImplementation(async (data) => {
        nextId += 1;
        return { donationId: nextId, unit: { id: nextId, unitCode: data.buildUnitCode(nextId) } };
      }),
    },
    now: NOW,
  };
}

describe('TC-Don-04: offline camp sync (unit)', () => {
  describe('normaliseClientRef', () => {
    it('accepts a UUID and lower-cases it', () => {
      expect(normaliseClientRef(` ${REF_A.toUpperCase()} `)).toBe(REF_A);
    });

    it.each([undefined, null, 42, '', 'not-a-uuid', '3f2a9c1b0d4e4f6a9b8c1a2b3c4d5e6f'])(
      'rejects %p',
      (value) => {
        expect(normaliseClientRef(value)).toBeNull();
      }
    );
  });

  describe('validateCampRecord', () => {
    it('accepts a complete record and keeps the original collection time', () => {
      const record = campRecord();
      const result = validateCampRecord(record, NOW);

      expect(result.isValid).toBe(true);
      expect(result.value.collectedAt.toISOString()).toBe(record.collectedAt);
      expect(result.value.donorCode).toBe('D-000011');
      expect(result.value.vitals.hemoglobinGDl).toBe(13.5);
    });

    it('accepts collectedAt exactly now (boundary)', () => {
      expect(validateCampRecord(campRecord({ collectedAt: NOW.toISOString() }), NOW).isValid).toBe(true);
    });

    it('accepts collectedAt 4 minutes ahead, within the clock-skew allowance (boundary)', () => {
      const collectedAt = new Date(NOW.getTime() + 4 * 60 * 1000).toISOString();
      expect(validateCampRecord(campRecord({ collectedAt }), NOW).isValid).toBe(true);
    });

    it('accepts collectedAt exactly at the skew limit (boundary)', () => {
      const collectedAt = new Date(NOW.getTime() + CLOCK_SKEW_MS).toISOString();
      expect(validateCampRecord(campRecord({ collectedAt }), NOW).isValid).toBe(true);
    });

    it('rejects collectedAt 6 minutes in the future (boundary)', () => {
      const collectedAt = new Date(NOW.getTime() + 6 * 60 * 1000).toISOString();
      const result = validateCampRecord(campRecord({ collectedAt }), NOW);

      expect(result.isValid).toBe(false);
      expect(result.errors.collectedAt).toMatch(/future/);
    });

    it.each([undefined, '', 'yesterday', 12345])('rejects collectedAt %p', (collectedAt) => {
      const result = validateCampRecord(campRecord({ collectedAt }), NOW);
      expect(result.errors.collectedAt).toBeDefined();
    });

    it('requires a camp location of at most 150 characters (boundary)', () => {
      expect(validateCampRecord(campRecord({ campLocation: '   ' }), NOW).errors.campLocation)
        .toMatch(/required/);
      expect(validateCampRecord(campRecord({ campLocation: 'x'.repeat(150) }), NOW).isValid).toBe(true);
      expect(validateCampRecord(campRecord({ campLocation: 'x'.repeat(151) }), NOW).errors.campLocation)
        .toMatch(/150/);
    });

    it('rejects a donor ID that is not a donor code', () => {
      expect(validateCampRecord(campRecord({ donorId: '11' }), NOW).errors.donorId).toBeDefined();
    });

    it('reuses the session and vitals rules (volume, missing haemoglobin, diastolic >= systolic)', () => {
      const result = validateCampRecord(
        campRecord({
          volumeMl: 0,
          vitals: { bpSystolic: 80, bpDiastolic: 90, pulseBpm: 72 },
        }),
        NOW
      );

      expect(result.errors).toEqual(expect.objectContaining({
        volumeMl: expect.any(String),
        hemoglobinGDl: expect.any(String),
        bpDiastolic: expect.any(String),
      }));
    });
  });

  describe('syncCampRecords', () => {
    it('creates a donation for a valid record (201) with camp location, staff and original time', async () => {
      const repos = mockRepos();
      const record = campRecord();

      const { results, summary } = await syncCampRecords({ records: [record] }, STAFF_ID, repos);

      expect(results[0]).toEqual(expect.objectContaining({
        clientRef: REF_A,
        status: 201,
        outcome: 'CREATED',
        donationId: 101,
      }));
      expect(results[0].unit).toEqual(expect.objectContaining({
        unitId: 'U-2026-000101',
        status: 'QUARANTINE',
        bloodGroup: 'PENDING',
        barcode: { format: 'CODE128', value: 'U-2026-000101' },
      }));
      expect(summary).toEqual({ created: 1, alreadySynced: 0, rejected: 0, failed: 0 });

      const saved = repos.collectionRepo.createSyncedSession.mock.calls[0][0];
      expect(saved).toEqual(expect.objectContaining({
        clientRef: REF_A,
        donorId: 11,
        collectedBy: STAFF_ID,
        campLocation: 'PES University camp',
      }));
      expect(saved.collectedAt.toISOString()).toBe(record.collectedAt);
      // Shelf life is counted from the camp collection time, not the sync time
      expect(saved.unit.expiresAt.getTime()).toBe(new Date(record.collectedAt).getTime() + 35 * DAY_MS);
    });

    it('returns the existing donation (200) for a replayed clientRef without saving or validating again', async () => {
      const repos = mockRepos({ existing: existingRow(), donor: null });

      const { results } = await syncCampRecords(
        { records: [campRecord({ volumeMl: 'broken' })] },
        STAFF_ID,
        repos
      );

      expect(results[0]).toEqual(expect.objectContaining({
        status: 200,
        outcome: 'ALREADY_SYNCED',
        donationId: 40,
      }));
      expect(results[0].unit.unitId).toBe('U-2026-000090');
      expect(repos.collectionRepo.createSyncedSession).not.toHaveBeenCalled();
      expect(repos.donorRepo.findByIdOrCode).not.toHaveBeenCalled();
    });

    it('returns 200 when a parallel sync saved the same clientRef first (ER_DUP_ENTRY)', async () => {
      const repos = mockRepos();
      repos.collectionRepo.findSessionByClientRef
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingRow());
      repos.collectionRepo.createSyncedSession.mockRejectedValue(
        Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' })
      );

      const { results } = await syncCampRecords({ records: [campRecord()] }, STAFF_ID, repos);

      expect(results[0]).toEqual(expect.objectContaining({ status: 200, outcome: 'ALREADY_SYNCED' }));
    });

    it('keeps going after a bad record in a mixed batch', async () => {
      const repos = mockRepos();
      const bad = campRecord({ clientRef: REF_B, collectedAt: new Date(NOW.getTime() + DAY_MS).toISOString() });

      const { results, summary } = await syncCampRecords(
        { records: [bad, campRecord(), { clientRef: 'nope' }] },
        STAFF_ID,
        repos
      );

      expect(results.map((r) => r.status)).toEqual([400, 201, 400]);
      expect(results[0].errors.collectedAt).toMatch(/future/);
      expect(results[2]).toEqual(expect.objectContaining({ clientRef: 'nope', outcome: 'REJECTED' }));
      expect(summary).toEqual({ created: 1, alreadySynced: 0, rejected: 2, failed: 0 });
    });

    it('rejects an unknown donor with 404', async () => {
      const { results } = await syncCampRecords({ records: [campRecord()] }, STAFF_ID, mockRepos({ donor: null }));
      expect(results[0]).toEqual(expect.objectContaining({ status: 404, code: 'DONOR_NOT_FOUND' }));
    });

    it('rejects a donor without consent with 422 CONSENT_REQUIRED', async () => {
      const repos = mockRepos({ donor: { ...ELIGIBLE_DONOR, consent_given: 0 } });
      const { results } = await syncCampRecords({ records: [campRecord()] }, STAFF_ID, repos);
      expect(results[0]).toEqual(expect.objectContaining({ status: 422, code: 'CONSENT_REQUIRED' }));
    });

    it('rejects a DEFERRED donor with 422 and saves nothing', async () => {
      const repos = mockRepos({
        donor: { ...ELIGIBLE_DONOR, eligibility_status: 'DEFERRED', deferral_reason: 'Low weight' },
      });
      const { results } = await syncCampRecords({ records: [campRecord()] }, STAFF_ID, repos);

      expect(results[0]).toEqual(expect.objectContaining({ status: 422, code: 'DONOR_NOT_ELIGIBLE' }));
      expect(results[0].message).toMatch(/Low weight/);
      expect(repos.collectionRepo.createSyncedSession).not.toHaveBeenCalled();
    });

    it('accepts a PENDING donor whose camp haemoglobin passes screening', async () => {
      const repos = mockRepos({ donor: { ...ELIGIBLE_DONOR, eligibility_status: 'PENDING' } });
      const { results } = await syncCampRecords({ records: [campRecord()] }, STAFF_ID, repos);
      expect(results[0].status).toBe(201);
    });

    it('rejects low camp haemoglobin (12.4 g/dL, boundary) with 422', async () => {
      const record = campRecord({ vitals: { bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, hemoglobinGDl: 12.4 } });
      const { results } = await syncCampRecords({ records: [record] }, STAFF_ID, mockRepos());
      expect(results[0]).toEqual(expect.objectContaining({ status: 422, code: 'DONOR_NOT_ELIGIBLE' }));
    });

    it('measures the 90-day gap from the camp collection time (89 days rejected, 90 accepted)', async () => {
      const record = campRecord();
      const collected = new Date(record.collectedAt).getTime();

      const tooSoon = mockRepos({ lastDonation: { collected_at: new Date(collected - 89 * DAY_MS) } });
      expect((await syncCampRecords({ records: [record] }, STAFF_ID, tooSoon)).results[0].status).toBe(422);

      const justOk = mockRepos({ lastDonation: { collected_at: new Date(collected - 90 * DAY_MS) } });
      expect((await syncCampRecords({ records: [record] }, STAFF_ID, justOk)).results[0].status).toBe(201);
    });

    it('rejects a unit that would already be expired at sync time (422 UNIT_EXPIRED)', async () => {
      const record = campRecord({
        donationType: 'APHERESIS',
        collectedAt: new Date(NOW.getTime() - 6 * DAY_MS).toISOString(),
      });
      const { results } = await syncCampRecords({ records: [record] }, STAFF_ID, mockRepos());
      expect(results[0]).toEqual(expect.objectContaining({ status: 422, code: 'UNIT_EXPIRED' }));
    });

    it('reports an unexpected error on one record as FAILED (500) and carries on', async () => {
      const repos = mockRepos();
      repos.collectionRepo.createSyncedSession
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValueOnce({ donationId: 5, unit: { id: 5, unitCode: 'U-2026-000005' } });

      const { results, summary } = await syncCampRecords(
        { records: [campRecord(), campRecord({ clientRef: REF_B })] },
        STAFF_ID,
        repos
      );

      expect(results.map((r) => r.status)).toEqual([500, 201]);
      expect(results[0].outcome).toBe('FAILED');
      expect(summary.failed).toBe(1);
    });

    it.each([
      ['no body', undefined],
      ['records not an array', { records: 'x' }],
      ['0 records (boundary)', { records: [] }],
      [`${MAX_SYNC_BATCH + 1} records (boundary)`, { records: Array.from({ length: MAX_SYNC_BATCH + 1 }, () => campRecord()) }],
    ])('rejects the whole request with 400 for %s', async (label, body) => {
      await expect(syncCampRecords(body, STAFF_ID, mockRepos())).rejects.toMatchObject({ status: 400 });
    });

    it(`accepts exactly ${MAX_SYNC_BATCH} records (boundary)`, async () => {
      const repos = mockRepos({ existing: existingRow() });
      const records = Array.from({ length: MAX_SYNC_BATCH }, () => campRecord());

      const { results } = await syncCampRecords({ records }, STAFF_ID, repos);
      expect(results).toHaveLength(MAX_SYNC_BATCH);
    });
  });
});
