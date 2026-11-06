const inventoryRepository = require('./inventory.repository');
const { formatUnitCode, normaliseUnitCode, buildUnitRecord } = require('../collection/collection.service');

// BBMS-F-030: real-time stock summary for the inventory dashboard.
// Returns releasable stock per blood group and component, plus overall totals.
// generatedAt tells the dashboard how fresh the numbers are (AC: changes visible within 5 s).
async function getStockSummary({ now = new Date() } = {}) {
  const rows = await inventoryRepository.summarizeAvailable();

  const stock = rows.map((row) => ({
    bloodGroup: row.blood_group,
    component: row.component,
    units: Number(row.units),
    volumeMl: Number(row.volume_ml), // MySQL returns SUM() as a string
    nextExpiry: row.next_expiry,
  }));

  const totals = stock.reduce(
    (sum, entry) => ({
      units: sum.units + entry.units,
      volumeMl: sum.volumeMl + entry.volumeMl,
      nextExpiry:
        sum.nextExpiry === null || new Date(entry.nextExpiry) < new Date(sum.nextExpiry)
          ? entry.nextExpiry
          : sum.nextExpiry,
    }),
    { units: 0, volumeMl: 0, nextExpiry: null }
  );

  return { generatedAt: now.toISOString(), totals, stock };
}

/**
 * BBMS-F-031: Components a whole-blood unit can be separated into, with their shelf life
 * (counted from the parent's collection time) and default volume for a standard bag.
 * These are team assumptions (see DEVIATIONS.md).
 */
const COMPONENT_SPECS = {
  PRBC: { shelfLifeDays: 42, defaultVolumeMl: 280 },
  FFP: { shelfLifeDays: 365, defaultVolumeMl: 200 },
  PLATELETS: { shelfLifeDays: 5, defaultVolumeMl: 50 },
  CRYO: { shelfLifeDays: 365, defaultVolumeMl: 15 },
};
const SEPARABLE_COMPONENTS = Object.keys(COMPONENT_SPECS);

// Only units that are still in the bank can be separated
const SEPARABLE_STATUSES = ['QUARANTINE', 'AVAILABLE'];

const MAX_COMPONENT_VOLUME_ML = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status }, extra);
}

/**
 * BBMS-F-031: Expiry of a component. It counts from when the blood was collected, not from
 * when it was separated, so separating a bag can never make its blood last longer.
 * @param {string} component
 * @param {Date|string} collectedAt the parent unit's collection time
 * @returns {Date}
 */
function componentExpiry(component, collectedAt) {
  return new Date(new Date(collectedAt).getTime() + COMPONENT_SPECS[component].shelfLifeDays * DAY_MS);
}

/**
 * BBMS-F-031: Validates the requested components (400 on failure).
 * Body: { components: ['PRBC', 'FFP', ...], volumes?: { PRBC: 250, ... } }
 * @returns {{ isValid: boolean, errors: object, components: Array<{ component: string, volumeMl: number }> }}
 */
function validateSeparationInput(body = {}) {
  const errors = {};
  const raw = body.components;
  let names = [];

  if (!Array.isArray(raw) || raw.length === 0) {
    errors.components = `Choose at least one component: ${SEPARABLE_COMPONENTS.join(', ')}`;
  } else {
    names = raw.map((value) => (typeof value === 'string' ? value.trim().toUpperCase() : ''));
    if (names.some((name) => !SEPARABLE_COMPONENTS.includes(name))) {
      errors.components = `Components must be from: ${SEPARABLE_COMPONENTS.join(', ')}`;
    } else if (new Set(names).size !== names.length) {
      errors.components = 'Each component can be chosen only once';
    }
  }

  const volumes = body.volumes === undefined || body.volumes === null ? {} : body.volumes;
  if (typeof volumes !== 'object' || Array.isArray(volumes)) {
    errors.volumes = 'Volumes must be an object such as { "PRBC": 250 }';
  } else if (!errors.components) {
    Object.entries(volumes).forEach(([name, value]) => {
      const key = name.toUpperCase();
      if (!names.includes(key)) {
        errors.volumes = `A volume was given for ${name}, which was not chosen`;
      } else if (!Number.isInteger(value) || value <= 0 || value > MAX_COMPONENT_VOLUME_ML) {
        errors.volumes = `Volume for ${key} must be a whole number of mL between 1 and ${MAX_COMPONENT_VOLUME_ML}`;
      }
    });
  }

  const upperVolumes = Object.fromEntries(
    Object.entries(errors.volumes ? {} : volumes).map(([name, value]) => [name.toUpperCase(), value])
  );

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    components: errors.components
      ? []
      : names.map((component) => ({
        component,
        volumeMl: upperVolumes[component] ?? COMPONENT_SPECS[component].defaultVolumeMl,
      })),
  };
}

/**
 * BBMS-F-031: Checks that a (locked) unit may be separated. Throws with an HTTP status if not.
 * - Only whole blood can be separated (422). Apheresis units are already PLATELETS.
 * - A unit is separated only once (409), and only while it is still in the bank:
 *   QUARANTINE or AVAILABLE and not past its expiry (409 otherwise).
 */
function assertSeparable(unit, now = new Date()) {
  if (unit.component !== 'WHOLE_BLOOD') {
    throw httpError(422, `Only whole blood can be separated (this unit is ${unit.component})`, {
      code: 'NOT_WHOLE_BLOOD',
    });
  }
  if (unit.status === 'SEPARATED') {
    throw httpError(409, 'This unit has already been separated into components', {
      code: 'ALREADY_SEPARATED',
    });
  }
  if (!SEPARABLE_STATUSES.includes(unit.status)) {
    throw httpError(409, `A unit that is ${unit.status} cannot be separated`, { code: 'UNIT_NOT_SEPARABLE' });
  }
  if (new Date(unit.expires_at).getTime() <= now.getTime()) {
    throw httpError(409, 'This unit is past its expiry date and cannot be separated', { code: 'UNIT_EXPIRED' });
  }
}

/**
 * BBMS-F-031: The components to create from a parent unit. A component that would already be
 * expired (e.g. platelets from a bag collected more than 5 days ago) is refused with 422.
 */
function planComponents(parent, components, now = new Date()) {
  return components.map(({ component, volumeMl }) => {
    const expiresAt = componentExpiry(component, parent.collected_at);
    if (expiresAt.getTime() <= now.getTime()) {
      throw httpError(422, `${component} from this unit would already be past its expiry date`, {
        code: 'COMPONENT_EXPIRED',
      });
    }
    return { component, volumeMl, expiresAt };
  });
}

function parseUnitCode(rawCode) {
  const unitCode = normaliseUnitCode(rawCode);
  if (!unitCode) {
    throw httpError(400, 'Validation failed', { errors: { unitCode: 'Unit ID must look like U-2026-000123' } });
  }
  return unitCode;
}

/**
 * BBMS-F-031: Separates a whole-blood unit into components.
 * Each component gets its own unit ID, keeps the parent's donation, blood group, status and
 * collection time, and is linked to the parent. The parent becomes SEPARATED.
 * @returns {Promise<{ parent: object, children: object[] }>}
 */
async function separateUnit(rawCode, body, userId, { repository = inventoryRepository, now = new Date() } = {}) {
  const unitCode = parseUnitCode(rawCode);

  const validation = validateSeparationInput(body);
  if (!validation.isValid) {
    throw httpError(400, 'Validation failed', { errors: validation.errors });
  }

  const result = await repository.separateUnit(
    unitCode,
    (parent) => {
      assertSeparable(parent, now);
      return planComponents(parent, validation.components, now);
    },
    {
      userId,
      buildUnitCode: (parent, id) => formatUnitCode(new Date(parent.collected_at).getFullYear(), id),
    }
  );
  if (result.notFound) throw httpError(404, 'Blood unit not found');

  return {
    parent: buildUnitRecord(result.parent),
    children: result.children.map(buildUnitRecord),
  };
}

/**
 * BBMS-F-031: Traceability for a unit: its parent, its components, its sibling components
 * and the donation they all come from.
 */
async function getLineage(rawCode, { repository = inventoryRepository } = {}) {
  const unitCode = parseUnitCode(rawCode);

  const lineage = await repository.findLineage(unitCode);
  if (!lineage) throw httpError(404, 'Blood unit not found');

  const { unit, parent, children, siblings, donation } = lineage;
  return {
    unit: buildUnitRecord(unit),
    parent: parent ? buildUnitRecord(parent) : null,
    children: children.map(buildUnitRecord),
    siblings: siblings.map(buildUnitRecord),
    donation: donation
      ? {
        donationId: donation.donation_id,
        donorCode: donation.donor_code,
        donationType: donation.donation_type,
        collectedAt: donation.collected_at,
        campLocation: donation.camp_location,
      }
      : null,
  };
}

module.exports = {
  getStockSummary,
  COMPONENT_SPECS,
  componentExpiry,
  validateSeparationInput,
  assertSeparable,
  planComponents,
  separateUnit,
  getLineage,
};
