const defaultDonorRepository = require('../donor/donor.repository');
const defaultCollectionRepository = require('./collection.repository');

/**
 * BBMS-F-010: Donation types a session can record.
 */
const DONATION_TYPES = ['WHOLE_BLOOD', 'APHERESIS'];

/**
 * BBMS-F-010: The blood unit each donation type produces, and its shelf life in days.
 * Apheresis is recorded as a platelet unit (see DEVIATIONS.md).
 */
const UNIT_SPEC_BY_DONATION_TYPE = {
  WHOLE_BLOOD: { component: 'WHOLE_BLOOD', shelfLifeDays: 35 },
  APHERESIS: { component: 'PLATELETS', shelfLifeDays: 5 },
};

// Sanity cap: no real bag is anywhere near this (volume_ml is a SMALLINT column).
const MAX_VOLUME_ML = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * BBMS-F-010: Formats a blood unit code, e.g. U-2026-000123 (same format as seed.sql).
 * @param {number} year
 * @param {number|string} seqNumber
 * @returns {string}
 */
function formatUnitCode(year, seqNumber) {
  const num = Number(seqNumber);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error('Unit sequence number must be a positive integer');
  }
  return `U-${year}-${String(num).padStart(6, '0')}`;
}

/**
 * Normalises a donation type such as 'whole blood' or 'Apheresis' to its enum value.
 * Missing values default to WHOLE_BLOOD. Returns null for anything unknown.
 * @param {*} value
 * @returns {string|null}
 */
function normaliseDonationType(value) {
  if (value === undefined || value === null || value === '') return 'WHOLE_BLOOD';
  if (typeof value !== 'string') return null;
  const normalised = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return DONATION_TYPES.includes(normalised) ? normalised : null;
}

/**
 * BBMS-F-010: Validates the input for a donation session (400 on failure).
 * @param {object} input
 * @returns {{ isValid: boolean, errors: object, donationType: string|null, volumeMl: number|null }}
 */
function validateSessionInput(input = {}) {
  const errors = {};

  const donationType = normaliseDonationType(input.donationType);
  if (!donationType) {
    errors.donationType = `Donation type must be one of: ${DONATION_TYPES.join(', ')}`;
  }

  const rawVolume = input.volumeMl;
  let volumeMl = null;
  if (rawVolume !== undefined && rawVolume !== null && String(rawVolume).trim() !== '') {
    // Only numbers and numeric strings count; anything else (e.g. true) becomes NaN and is rejected
    volumeMl = typeof rawVolume === 'number' || typeof rawVolume === 'string' ? Number(rawVolume) : NaN;
  }
  if (volumeMl === null) {
    errors.volumeMl = 'Volume (mL) is required';
  } else if (!Number.isInteger(volumeMl) || volumeMl <= 0 || volumeMl > MAX_VOLUME_ML) {
    errors.volumeMl = `Volume must be a whole number of mL between 1 and ${MAX_VOLUME_ML}`;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    donationType,
    volumeMl,
  };
}

/**
 * BBMS-F-010: Builds the blood unit that a session creates.
 * @param {string} donationType
 * @param {number} volumeMl
 * @param {Date} collectedAt
 * @returns {{ component: string, volumeMl: number, expiresAt: Date }}
 */
function buildUnitForSession(donationType, volumeMl, collectedAt) {
  const spec = UNIT_SPEC_BY_DONATION_TYPE[donationType];
  return {
    component: spec.component,
    volumeMl,
    expiresAt: new Date(collectedAt.getTime() + spec.shelfLifeDays * DAY_MS),
  };
}

/**
 * BBMS-F-004 & BBMS-F-010: Starts a donation session and creates its blood unit.
 *
 * Acceptance criteria (BBMS-F-004):
 * 1. Consent must be captured before a donation can proceed (422 otherwise).
 *
 * Acceptance criteria (BBMS-F-010):
 * 1. Session records donor ID, date, time, staff ID and donation type.
 * 2. Only eligible donors who have given consent can start a session (422 otherwise).
 * 3. Each session creates a blood unit with a unique unit ID and status QUARANTINE.
 *
 * Date and time are taken from the server clock. The staff ID is the logged-in user,
 * which the route passes in as input.staffId.
 *
 * @param {object} input
 * @param {object} donorRepo
 * @param {object} collectionRepo
 * @returns {Promise<object>}
 */
async function startDonation(
  input,
  donorRepo = defaultDonorRepository,
  collectionRepo = defaultCollectionRepository
) {
  const donorIdentifier = input.donorId || input.donor_id;
  if (!donorIdentifier) {
    const error = new Error('donorId is required to start a donation');
    error.status = 400;
    throw error;
  }

  if (!input.staffId) {
    const error = new Error('staffId is required to start a donation');
    error.status = 400;
    throw error;
  }

  const validation = validateSessionInput(input);
  if (!validation.isValid) {
    const error = new Error('Validation failed');
    error.status = 400;
    error.errors = validation.errors;
    throw error;
  }
  const { donationType, volumeMl } = validation;

  // 1. Find donor
  const donor = await donorRepo.findByIdOrCode(donorIdentifier);
  if (!donor) {
    const error = new Error('Donor not found');
    error.status = 404;
    throw error;
  }

  // 2. BBMS-F-004: Attempting a donation without consent is rejected with 422
  if (!donor.consent_given) {
    const error = new Error('Consent must be captured before a donation can proceed');
    error.status = 422;
    error.code = 'CONSENT_REQUIRED';
    throw error;
  }

  // 3. BBMS-F-010: Only donors screened as ELIGIBLE (F-002) can start a session
  if (donor.eligibility_status !== 'ELIGIBLE') {
    const status = donor.eligibility_status || 'PENDING';
    const reason = donor.deferral_reason ? `: ${donor.deferral_reason}` : '';
    const error = new Error(`Donor is not eligible to donate (status ${status}${reason})`);
    error.status = 422;
    error.code = 'DONOR_NOT_ELIGIBLE';
    throw error;
  }

  // 4. Create the session and its QUARANTINE unit together
  const collectedAt = new Date();
  const unit = buildUnitForSession(donationType, volumeMl, collectedAt);

  const session = await collectionRepo.createSession({
    donorId: donor.id,
    collectedBy: input.staffId,
    collectedAt,
    donationType,
    campLocation: input.campLocation || null,
    volumeMl,
    weightKg: input.weightKg || input.weight || null,
    hemoglobinGDl: input.hemoglobinGDl || input.hemoglobin || null,
    unit,
    buildUnitCode: (unitId) => formatUnitCode(collectedAt.getFullYear(), unitId),
  });

  return {
    donationId: session.donationId,
    donorId: donor.donor_code,
    staffId: input.staffId,
    donationType,
    collectedAt,
    status: 'IN_PROGRESS',
    unit: {
      unitId: session.unit.unitCode,
      status: 'QUARANTINE',
      component: unit.component,
      volumeMl: unit.volumeMl,
      expiresAt: unit.expiresAt,
    },
  };
}

/**
 * BBMS-F-011: Vitals are recorded before (PRE) and after (POST) the donation.
 */
const VITAL_PHASES = ['PRE', 'POST'];

const PHASE_LABELS = { PRE: 'pre-donation', POST: 'post-donation' };

/**
 * BBMS-F-011: Rules for each vital sign.
 * valid: anything outside this is impossible input and is rejected with 400.
 * safe:  anything outside this is stored, but flagged with a warning.
 * Bounds are inclusive. The safe ranges are team assumptions (see DEVIATIONS.md).
 */
const VITAL_RULES = {
  bpSystolic: { label: 'Systolic BP', unit: 'mmHg', decimals: 0, valid: { min: 1, max: 300 }, safe: { min: 100, max: 140 } },
  bpDiastolic: { label: 'Diastolic BP', unit: 'mmHg', decimals: 0, valid: { min: 1, max: 200 }, safe: { min: 60, max: 90 } },
  pulseBpm: { label: 'Pulse', unit: 'bpm', decimals: 0, valid: { min: 1, max: 250 }, safe: { min: 60, max: 100 } },
  hemoglobinGDl: { label: 'Haemoglobin', unit: 'g/dL', decimals: 1, valid: { min: 0.1, max: 25 }, safe: { min: 12.5, max: 18 } },
};

const VITAL_FIELDS = Object.keys(VITAL_RULES);

// Haemoglobin is expected to drop right after donating, so a low post-donation
// reading is not flagged. A high one still is (see DEVIATIONS.md).
const POST_SAFE_RANGE_OVERRIDES = { hemoglobinGDl: { min: null } };

/**
 * BBMS-F-011: The safe range for one vital in one phase. min or max is null when there is no limit.
 * @param {string} field
 * @param {string} phase PRE or POST
 * @returns {{ min: number|null, max: number|null }}
 */
function safeRangeFor(field, phase) {
  const override = phase === 'POST' ? POST_SAFE_RANGE_OVERRIDES[field] : undefined;
  return { ...VITAL_RULES[field].safe, ...override };
}

function hasAtMostDecimals(value, decimals) {
  const scaled = value * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

function invalidVitalMessage({ label, unit, decimals, valid }) {
  if (decimals === 0) {
    return `${label} must be a whole number between ${valid.min} and ${valid.max} ${unit}`;
  }
  return `${label} must be between ${valid.min} and ${valid.max} ${unit}, with at most ${decimals} decimal place`;
}

/**
 * BBMS-F-011: Validates a set of vitals (400 on failure). All four readings are required.
 * Numbers and numeric strings are accepted; negative, non-numeric and impossible values are not.
 * @param {object} input
 * @returns {{ isValid: boolean, errors: object, vitals: object }}
 */
function validateVitals(input = {}) {
  const errors = {};
  const vitals = {};

  VITAL_FIELDS.forEach((field) => {
    const rule = VITAL_RULES[field];
    const raw = input[field];

    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      errors[field] = `${rule.label} is required`;
      return;
    }

    // Only numbers and numeric strings count; anything else (e.g. true) becomes NaN
    const value = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(value)) {
      errors[field] = `${rule.label} must be a number`;
      return;
    }

    if (value < rule.valid.min || value > rule.valid.max || !hasAtMostDecimals(value, rule.decimals)) {
      errors[field] = invalidVitalMessage(rule);
      return;
    }

    vitals[field] = value;
  });

  if (!errors.bpSystolic && !errors.bpDiastolic && vitals.bpDiastolic >= vitals.bpSystolic) {
    errors.bpDiastolic = 'Diastolic BP must be lower than systolic BP';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    vitals,
  };
}

/**
 * BBMS-F-011: Flags readings outside the safe range for the given phase.
 * @param {object} vitals validated vitals
 * @param {string} phase PRE or POST
 * @returns {Array<{ field: string, value: number, min: number|null, max: number|null, message: string }>}
 */
function checkVitalsSafety(vitals, phase = 'PRE') {
  const warnings = [];

  VITAL_FIELDS.forEach((field) => {
    const value = vitals[field];
    if (value === undefined || value === null) return;

    const { label, unit } = VITAL_RULES[field];
    const { min, max } = safeRangeFor(field, phase);
    let problem = null;
    if (min !== null && value < min) problem = `below the safe minimum of ${min} ${unit}`;
    if (max !== null && value > max) problem = `above the safe maximum of ${max} ${unit}`;

    if (problem) {
      warnings.push({
        field,
        value,
        min,
        max,
        message: `${label} ${value} ${unit} is ${problem} (${PHASE_LABELS[phase]})`,
      });
    }
  });

  return warnings;
}

/**
 * BBMS-F-011: Records pre- or post-donation vitals against a donation session.
 *
 * Acceptance criteria (BBMS-F-011):
 * 1. Captures pre- and post-donation BP, pulse and haemoglobin.
 * 2. Vitals stored against the donation session.
 * 3. Out-of-safe-range values are flagged with a visible warning (returned in `warnings`).
 * 4. Invalid values (negative, non-numeric) rejected with 400.
 *
 * Out-of-range values are still stored. Recording a phase again overwrites it, so typos can be fixed.
 *
 * @param {number|string} donationId
 * @param {string} phase PRE or POST
 * @param {object} input
 * @param {object} collectionRepo
 * @returns {Promise<{ donationId: number, phase: string, vitals: object, warnings: Array }>}
 */
async function recordVitals(donationId, phase, input, collectionRepo = defaultCollectionRepository) {
  if (!VITAL_PHASES.includes(phase)) {
    throw new Error(`Unknown vitals phase "${phase}"`);
  }

  // A non-numeric id can never match a donation (and MySQL would cast '12abc' to 12)
  const id = /^\d+$/.test(String(donationId)) ? Number(donationId) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    const error = new Error('Donation not found');
    error.status = 404;
    throw error;
  }

  const validation = validateVitals(input);
  if (!validation.isValid) {
    const error = new Error('Validation failed');
    error.status = 400;
    error.errors = validation.errors;
    throw error;
  }
  const { vitals } = validation;

  const donation = await collectionRepo.findById(id);
  if (!donation) {
    const error = new Error('Donation not found');
    error.status = 404;
    throw error;
  }

  await collectionRepo.updateVitals(id, phase, vitals);

  return {
    donationId: id,
    phase,
    vitals,
    warnings: checkVitalsSafety(vitals, phase),
  };
}

/**
 * BBMS-F-012: Barcode symbology for blood-unit labels. Code 128 can encode the
 * letters, digits and dashes of a unit code (see DEVIATIONS.md).
 */
const BARCODE_FORMAT = 'CODE128';

/**
 * BBMS-F-012: A unit code as built by formatUnitCode, e.g. U-2026-000123.
 */
const UNIT_CODE_PATTERN = /^U-\d{4}-\d{6,}$/;

/**
 * BBMS-F-012: Cleans up a scanned or typed unit code. Surrounding spaces and lower case
 * are accepted, so 'u-2026-000007 ' finds U-2026-000007.
 * @param {*} value
 * @returns {string|null} the unit code, or null if it is not a valid unit code
 */
function normaliseUnitCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return UNIT_CODE_PATTERN.test(code) ? code : null;
}

/**
 * BBMS-F-012: Turns a blood_units row into the unit record used for lookups and labels.
 * The barcode encodes exactly the unit ID. Blood group shows PENDING until lab testing (F-020).
 * @param {object} row
 * @returns {object}
 */
function buildUnitRecord(row) {
  return {
    unitId: row.unit_code,
    barcode: { format: BARCODE_FORMAT, value: row.unit_code },
    bloodGroup: row.blood_group || 'PENDING',
    component: row.component,
    volumeMl: row.volume_ml,
    status: row.status,
    collectedAt: row.collected_at,
    expiresAt: row.expires_at,
    donationId: row.donation_id,
  };
}

/**
 * BBMS-F-012: Looks up a blood unit by its barcode (its unit ID).
 *
 * Acceptance criteria (BBMS-F-012):
 * 1. Each unit's barcode encodes its unit ID (unit IDs are unique, F-010).
 * 2. The record has the unit ID, blood group (PENDING until lab testing) and collection date.
 * 4. Scanning or entering the code returns the matching unit record.
 *
 * @param {*} rawCode scanned or typed code
 * @param {object} collectionRepo
 * @returns {Promise<object>}
 */
async function getUnitByBarcode(rawCode, collectionRepo = defaultCollectionRepository) {
  const unitCode = normaliseUnitCode(rawCode);
  if (!unitCode) {
    const error = new Error('Validation failed');
    error.status = 400;
    error.errors = { unitId: 'Unit ID must look like U-2026-000123' };
    throw error;
  }

  const unit = await collectionRepo.findUnitByCode(unitCode);
  if (!unit) {
    const error = new Error('Blood unit not found');
    error.status = 404;
    throw error;
  }

  return buildUnitRecord(unit);
}

module.exports = {
  DONATION_TYPES,
  UNIT_SPEC_BY_DONATION_TYPE,
  formatUnitCode,
  normaliseDonationType,
  validateSessionInput,
  buildUnitForSession,
  startDonation,
  safeRangeFor,
  validateVitals,
  checkVitalsSafety,
  recordVitals,
  BARCODE_FORMAT,
  normaliseUnitCode,
  buildUnitRecord,
  getUnitByBarcode,
};
