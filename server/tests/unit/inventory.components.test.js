const {
  COMPONENT_SPECS,
  componentExpiry,
  validateSeparationInput,
  assertSeparable,
  planComponents,
  separateUnit,
  getLineage,
} = require('../../src/modules/inventory/inventory.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-06T10:00:00.000Z');

function daysBefore(days, extraMs = 0) {
  return new Date(NOW.getTime() - days * DAY_MS - extraMs);
}

function wholeBlood(overrides = {}) {
  return {
    id: 7,
    unit_code: 'U-2026-000007',
    donation_id: 4,
    parent_unit_id: null,
    component: 'WHOLE_BLOOD',
    blood_group: null,
    volume_ml: 450,
    collected_at: daysBefore(1),
    expires_at: new Date(daysBefore(1).getTime() + 35 * DAY_MS),
    status: 'QUARANTINE',
    ...overrides,
  };
}

// Behaves like the real repository: runs the service's plan on the "locked" parent
function mockRepository(parent = wholeBlood()) {
  return {
    separateUnit: jest.fn(async (code, planChildren, { buildUnitCode }) => {
      if (!parent) return { notFound: true };
      const plan = planChildren(parent);
      return {
        parent: { ...parent, status: 'SEPARATED' },
        children: plan.map((child, i) => ({
          id: 100 + i,
          unit_code: buildUnitCode(parent, 100 + i),
          donation_id: parent.donation_id,
          parent_unit_code: parent.unit_code,
          component: child.component,
          blood_group: parent.blood_group,
          volume_ml: child.volumeMl,
          collected_at: parent.collected_at,
          expires_at: child.expiresAt,
          status: parent.status,
        })),
      };
    }),
    findLineage: jest.fn(),
  };
}

describe('TC-Inv-02: blood component separation rules (unit)', () => {
  describe('componentExpiry (counted from the parent collection time)', () => {
    it.each([
      ['PRBC', 42],
      ['FFP', 365],
      ['PLATELETS', 5],
      ['CRYO', 365],
    ])('%s lasts %i days from collection', (component, days) => {
      const collectedAt = daysBefore(0);
      expect(componentExpiry(component, collectedAt).getTime()).toBe(collectedAt.getTime() + days * DAY_MS);
    });
  });

  describe('planComponents expiry boundaries', () => {
    const platelets = [{ component: 'PLATELETS', volumeMl: 50 }];
    const prbc = [{ component: 'PRBC', volumeMl: 280 }];

    it('platelets separated on day 4 after collection expire on day 5 after collection (not day 9)', () => {
      const parent = wholeBlood({ collected_at: daysBefore(4) });

      const [child] = planComponents(parent, platelets, NOW);

      expect(child.expiresAt.getTime()).toBe(daysBefore(4).getTime() + 5 * DAY_MS);
      expect(child.expiresAt.getTime() - NOW.getTime()).toBe(1 * DAY_MS);
    });

    it('refuses platelets from a bag collected exactly 5 days ago (boundary, 422)', () => {
      const parent = wholeBlood({ collected_at: daysBefore(5) });

      expect(() => planComponents(parent, platelets, NOW)).toThrow(
        expect.objectContaining({ status: 422, code: 'COMPONENT_EXPIRED' })
      );
    });

    it('allows platelets 1 second before the 5-day limit (boundary)', () => {
      const parent = wholeBlood({ collected_at: daysBefore(5, -1000) });
      expect(planComponents(parent, platelets, NOW)).toHaveLength(1);
    });

    it('PRBC from a bag collected 41 days ago is allowed, 42 days ago is refused (boundary)', () => {
      expect(planComponents(wholeBlood({ collected_at: daysBefore(41) }), prbc, NOW)[0].expiresAt.getTime())
        .toBe(daysBefore(41).getTime() + 42 * DAY_MS);
      expect(() => planComponents(wholeBlood({ collected_at: daysBefore(42) }), prbc, NOW))
        .toThrow(expect.objectContaining({ status: 422 }));
    });
  });

  describe('assertSeparable', () => {
    it.each(['QUARANTINE', 'AVAILABLE'])('allows a %s whole-blood unit', (status) => {
      expect(() => assertSeparable(wholeBlood({ status }), NOW)).not.toThrow();
    });

    it.each(['PRBC', 'FFP', 'PLATELETS', 'CRYO'])('refuses a %s unit with 422 NOT_WHOLE_BLOOD', (component) => {
      expect(() => assertSeparable(wholeBlood({ component }), NOW))
        .toThrow(expect.objectContaining({ status: 422, code: 'NOT_WHOLE_BLOOD' }));
    });

    it('refuses a second separation with 409 ALREADY_SEPARATED', () => {
      expect(() => assertSeparable(wholeBlood({ status: 'SEPARATED' }), NOW))
        .toThrow(expect.objectContaining({ status: 409, code: 'ALREADY_SEPARATED' }));
    });

    it.each(['RESERVED', 'ISSUED', 'DISCARDED', 'EXPIRED'])('refuses a %s unit with 409', (status) => {
      expect(() => assertSeparable(wholeBlood({ status }), NOW))
        .toThrow(expect.objectContaining({ status: 409, code: 'UNIT_NOT_SEPARABLE' }));
    });

    it('refuses an AVAILABLE unit that is past its expiry time (409)', () => {
      expect(() => assertSeparable(wholeBlood({ status: 'AVAILABLE', expires_at: NOW }), NOW))
        .toThrow(expect.objectContaining({ status: 409, code: 'UNIT_EXPIRED' }));
    });
  });

  describe('validateSeparationInput', () => {
    it('uses default volumes and accepts lower-case names', () => {
      const result = validateSeparationInput({ components: ['prbc', 'FFP', 'Platelets', 'cryo'] });

      expect(result.isValid).toBe(true);
      expect(result.components).toEqual([
        { component: 'PRBC', volumeMl: COMPONENT_SPECS.PRBC.defaultVolumeMl },
        { component: 'FFP', volumeMl: 200 },
        { component: 'PLATELETS', volumeMl: 50 },
        { component: 'CRYO', volumeMl: 15 },
      ]);
    });

    it('applies a volume override for a chosen component', () => {
      const result = validateSeparationInput({ components: ['PRBC'], volumes: { prbc: 250 } });
      expect(result.components).toEqual([{ component: 'PRBC', volumeMl: 250 }]);
    });

    it.each([
      ['missing', undefined],
      ['empty', []],
      ['unknown', ['PRBC', 'PLASMA']],
      ['duplicated', ['FFP', 'ffp']],
      ['WHOLE_BLOOD', ['WHOLE_BLOOD']],
    ])('rejects a %s component list', (label, components) => {
      expect(validateSeparationInput({ components }).errors.components).toBeDefined();
    });

    it.each([
      ['zero', { PRBC: 0 }],
      ['over 1000 mL', { PRBC: 1001 }],
      ['not a whole number', { PRBC: 250.5 }],
      ['for a component not chosen', { FFP: 200 }],
    ])('rejects a volume that is %s', (label, volumes) => {
      expect(validateSeparationInput({ components: ['PRBC'], volumes }).errors.volumes).toBeDefined();
    });

    it('accepts 1000 mL (boundary)', () => {
      expect(validateSeparationInput({ components: ['PRBC'], volumes: { PRBC: 1000 } }).isValid).toBe(true);
    });
  });

  describe('separateUnit', () => {
    it('creates linked components with unit codes from the F-012 generator', async () => {
      const repository = mockRepository();

      const result = await separateUnit(' u-2026-000007 ', { components: ['PRBC', 'FFP'] }, 3, { repository, now: NOW });

      expect(repository.separateUnit).toHaveBeenCalledWith('U-2026-000007', expect.any(Function), expect.objectContaining({ userId: 3 }));
      expect(result.parent).toEqual(expect.objectContaining({ unitId: 'U-2026-000007', status: 'SEPARATED' }));
      expect(result.children.map((c) => [c.unitId, c.component, c.parentUnitCode, c.status])).toEqual([
        ['U-2026-000100', 'PRBC', 'U-2026-000007', 'QUARANTINE'],
        ['U-2026-000101', 'FFP', 'U-2026-000007', 'QUARANTINE'],
      ]);
    });

    it('returns 400 for a malformed unit code without touching the repository', async () => {
      const repository = mockRepository();
      await expect(separateUnit('BAG-7', { components: ['PRBC'] }, 3, { repository, now: NOW }))
        .rejects.toMatchObject({ status: 400 });
      expect(repository.separateUnit).not.toHaveBeenCalled();
    });

    it('returns 400 for a bad component list', async () => {
      await expect(separateUnit('U-2026-000007', { components: [] }, 3, { repository: mockRepository(), now: NOW }))
        .rejects.toMatchObject({ status: 400, errors: { components: expect.any(String) } });
    });

    it('returns 404 for an unknown unit', async () => {
      await expect(separateUnit('U-2026-999999', { components: ['PRBC'] }, 3, { repository: mockRepository(null), now: NOW }))
        .rejects.toMatchObject({ status: 404 });
    });

    it('passes on the rule errors from the locked parent (e.g. 409 already separated)', async () => {
      const repository = mockRepository(wholeBlood({ status: 'SEPARATED' }));
      await expect(separateUnit('U-2026-000007', { components: ['PRBC'] }, 3, { repository, now: NOW }))
        .rejects.toMatchObject({ status: 409, code: 'ALREADY_SEPARATED' });
    });
  });

  describe('getLineage', () => {
    it('maps parent, children, siblings and donation', async () => {
      const repository = mockRepository();
      const parent = wholeBlood({ status: 'SEPARATED' });
      const child = { ...wholeBlood({ id: 8, unit_code: 'U-2026-000008', component: 'PRBC' }), parent_unit_code: 'U-2026-000007' };
      const sibling = { ...child, id: 9, unit_code: 'U-2026-000009', component: 'FFP' };
      repository.findLineage.mockResolvedValue({
        unit: child,
        parent,
        children: [],
        siblings: [sibling],
        donation: { donation_id: 4, donor_code: 'D-000004', donation_type: 'WHOLE_BLOOD', collected_at: NOW, camp_location: null },
      });

      const lineage = await getLineage('U-2026-000008', { repository });

      expect(lineage.unit.parentUnitCode).toBe('U-2026-000007');
      expect(lineage.parent.unitId).toBe('U-2026-000007');
      expect(lineage.siblings.map((s) => s.unitId)).toEqual(['U-2026-000009']);
      expect(lineage.donation).toEqual(expect.objectContaining({ donationId: 4, donorCode: 'D-000004' }));
    });

    it('returns 404 for an unknown unit and 400 for a malformed code', async () => {
      const repository = mockRepository();
      repository.findLineage.mockResolvedValue(null);
      await expect(getLineage('U-2026-999999', { repository })).rejects.toMatchObject({ status: 404 });
      await expect(getLineage('nope', { repository })).rejects.toMatchObject({ status: 400 });
    });
  });
});
