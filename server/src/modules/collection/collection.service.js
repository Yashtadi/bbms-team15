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

module.exports = {
  DONATION_TYPES,
  UNIT_SPEC_BY_DONATION_TYPE,
  formatUnitCode,
  normaliseDonationType,
  validateSessionInput,
  buildUnitForSession,
  startDonation,
};
