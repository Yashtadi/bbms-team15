const defaultRepository = require('./donor.repository');

/**
 * Validates donor registration input.
 * BBMS-F-001 (SRS §4.1)
 */
function validateDonorRegistration(input = {}) {
  const errors = {};

  const name = (input.name || input.fullName || '').toString().trim();
  if (!name) {
    errors.name = 'Full name is required';
  }

  const age = input.age !== undefined && input.age !== null && input.age !== '' 
    ? Number(input.age) 
    : null;
  const dateOfBirth = input.dateOfBirth ? input.dateOfBirth.toString().trim() : null;

  if (age === null && !dateOfBirth) {
    errors.age = 'Age is required';
  } else if (age !== null && (!Number.isInteger(age) || age < 18 || age > 65)) {
    errors.age = 'Age must be between 18 and 65';
  } else if (dateOfBirth && isNaN(Date.parse(dateOfBirth))) {
    errors.dateOfBirth = 'Invalid date of birth';
  }

  const rawGender = (input.gender || '').toString().trim().toUpperCase();
  const validGenders = ['MALE', 'FEMALE', 'OTHER'];
  if (!rawGender || !validGenders.includes(rawGender)) {
    errors.gender = 'Gender must be MALE, FEMALE, or OTHER';
  }

  const phone = (input.contact || input.phone || '').toString().trim();
  const phoneRegex = /^\+?[0-9]{10,15}$/;
  if (!phone) {
    errors.contact = 'Contact number is required';
  } else if (!phoneRegex.test(phone.replace(/[\s-]/g, ''))) {
    errors.contact = 'Invalid contact number';
  }

  const idProof = (input.idProof || input.id_proof || '').toString().trim();
  if (!idProof) {
    errors.idProof = 'ID proof is required';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Derives a valid date string (YYYY-MM-DD) from age or provided dateOfBirth.
 */
function resolveDateOfBirth(age, dateOfBirth) {
  if (dateOfBirth) return dateOfBirth;
  const now = new Date();
  const year = now.getFullYear() - age;
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * BBMS-F-003: Formats a sequence number into the human-readable Donor ID.
 * Standard format: D-XXXXXX (e.g. D-000123)
 * @param {number|string} seqNumber
 * @returns {string}
 */
function formatDonorCode(seqNumber) {
  const num = Number(seqNumber);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error('Donor ID sequence number must be a positive integer');
  }
  return `D-${String(num).padStart(6, '0')}`;
}

/**
 * BBMS-F-003: Validates whether a string matches the agreed human-readable Donor ID format.
 * Acceptance criteria: Human-readable format (e.g. D-000123)
 * @param {string} code
 * @returns {boolean}
 */
function isValidDonorCode(code) {
  if (typeof code !== 'string') return false;
  return /^D-\d{6,}$/.test(code.trim());
}

/**
 * BBMS-F-003: Parses the numeric sequence number out of a Donor ID.
 * @param {string} code
 * @returns {number|null}
 */
function parseDonorCode(code) {
  if (typeof code !== 'string') return null;
  const match = /^D-(\d+)$/.exec(code.trim());
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Calculates current age from a date of birth.
 * @param {string|Date} dateOfBirth
 * @returns {number}
 */
function calculateAge(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * BBMS-F-002: Core donor eligibility rules (SRS §4.1).
 */
function checkEligibility(criteria = {}) {
  const reasons = [];

  // 1. Resolve & check age
  let age = criteria.age !== undefined && criteria.age !== null ? Number(criteria.age) : null;
  if (age === null && criteria.dateOfBirth) {
    age = calculateAge(criteria.dateOfBirth);
  }

  if (age !== null) {
    if (age < 18) {
      reasons.push(`Donor age must be between 18 and 65 (donor is ${age})`);
    } else if (age > 65) {
      reasons.push(`Donor age must be between 18 and 65 (donor is ${age})`);
    }
  }

  // 2. Check weight (>= 45 kg)
  const weight = criteria.weight !== undefined && criteria.weight !== null
    ? Number(criteria.weight)
    : criteria.weight_kg !== undefined && criteria.weight_kg !== null
      ? Number(criteria.weight_kg)
      : null;

  if (weight !== null) {
    if (weight < 45) {
      reasons.push(`Weight must be at least 45 kg (donor weighs ${weight} kg)`);
    }
  }

  // 3. Check haemoglobin (>= 12.5 g/dL)
  const hemoglobin = criteria.hemoglobin !== undefined && criteria.hemoglobin !== null
    ? Number(criteria.hemoglobin)
    : criteria.hemoglobin_g_dl !== undefined && criteria.hemoglobin_g_dl !== null
      ? Number(criteria.hemoglobin_g_dl)
      : null;

  if (hemoglobin !== null) {
    if (hemoglobin < 12.5) {
      reasons.push(`Haemoglobin must be at least 12.5 g/dL (measured ${hemoglobin} g/dL)`);
    }
  }

  // 4. Check donation gap (>= 90 days)
  let daysGap = criteria.daysSinceLastDonation !== undefined && criteria.daysSinceLastDonation !== null
    ? Number(criteria.daysSinceLastDonation)
    : null;

  if (daysGap === null && criteria.lastDonationDate) {
    const lastDate = new Date(criteria.lastDonationDate);
    const now = new Date();
    const diffMs = now.getTime() - lastDate.getTime();
    daysGap = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  if (daysGap !== null) {
    if (daysGap < 90) {
      reasons.push(`At least 90 days required since last donation (only ${daysGap} days elapsed)`);
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    reason: reasons.length > 0 ? reasons.join('; ') : null,
  };
}

/**
 * Convenience helper returning boolean eligibility.
 */
function isEligible(criteria) {
  return checkEligibility(criteria).eligible;
}

/**
 * Registers a new donor following BBMS-F-001 (SRS §4.1, SAD §4.3).
 * BBMS-F-003:
 * - Automatically generates a unique, human-readable Donor ID.
 * BBMS-F-004:
 * - Captures digital consent if given at registration.
 */
async function registerDonor(input, repository = defaultRepository) {
  const validation = validateDonorRegistration(input);
  if (!validation.isValid) {
    const error = new Error('Validation failed');
    error.status = 400;
    error.errors = validation.errors;
    throw error;
  }

  const idProof = (input.idProof || input.id_proof).toString().trim();

  // Check duplicate ID proof
  const existingDonor = await repository.findByIdProof(idProof);
  if (existingDonor) {
    const error = new Error('A donor with this ID proof is already registered');
    error.status = 409;
    throw error;
  }

  const age = input.age !== undefined && input.age !== null ? Number(input.age) : null;
  const dateOfBirth = resolveDateOfBirth(age, input.dateOfBirth);
  const fullName = (input.name || input.fullName).toString().trim();
  const gender = input.gender.toString().trim().toUpperCase();
  const phone = (input.contact || input.phone).toString().trim().replace(/[\s-]/g, '');
  const email = input.email ? input.email.toString().trim() : null;
  const address = input.address ? input.address.toString().trim() : null;
  const medicalHistory = input.medicalHistory ? input.medicalHistory.toString().trim() : null;

  // BBMS-F-004: Optional consent on registration
  const consentGiven = Boolean(input.consentGiven || input.consent);
  const consentAt = consentGiven ? new Date() : null;

  // Generate unique human-readable donor code (e.g. D-000123)
  const donorCode = await repository.generateNextDonorCode();

  await repository.createDonor({
    donorCode,
    fullName,
    dateOfBirth,
    gender,
    phone,
    email,
    address,
    idProof,
    medicalHistory,
    eligibilityStatus: 'PENDING',
    consentGiven,
    consentAt,
  });

  return {
    donorId: donorCode,
    status: 'PENDING',
  };
}

/**
 * BBMS-F-004: Digitally captures and links consent to a donor with a timestamp.
 * Acceptance criteria:
 * 1. Consent must be captured before a donation can proceed.
 * 2. Consent stored with a timestamp and linked to the Donor ID.
 * 
 * @param {number|string} donorIdOrCode
 * @param {boolean} consentGiven
 * @param {object} repository
 * @returns {Promise<{ donorId: string, consentGiven: boolean, consentAt: Date }>}
 */
async function recordConsent(donorIdOrCode, consentGiven = true, repository = defaultRepository) {
  const donor = await repository.findByIdOrCode(donorIdOrCode);
  if (!donor) {
    const error = new Error('Donor not found');
    error.status = 404;
    throw error;
  }

  if (consentGiven !== true && consentGiven !== 'true' && consentGiven !== 1) {
    const error = new Error('Consent must be explicitly granted (consentGiven: true)');
    error.status = 400;
    throw error;
  }

  const consentAt = new Date();
  await repository.updateConsent(donor.id, true, consentAt);

  return {
    donorId: donor.donor_code,
    consentGiven: true,
    consentAt,
  };
}

/**
 * BBMS-F-002: Evaluates eligibility for an existing donor in the database.
 */
async function evaluateDonorEligibility(donorIdOrCode, vitals = {}, repository = defaultRepository) {
  const donor = await repository.findByIdOrCode(donorIdOrCode);
  if (!donor) {
    const error = new Error('Donor not found');
    error.status = 404;
    throw error;
  }

  const lastDonation = await repository.findLastDonation(donor.id);
  const lastDonationDate = lastDonation ? lastDonation.collected_at : null;

  const criteria = {
    dateOfBirth: donor.date_of_birth,
    age: vitals.age,
    weight: vitals.weight !== undefined ? vitals.weight : vitals.weight_kg,
    hemoglobin: vitals.hemoglobin !== undefined ? vitals.hemoglobin : vitals.hemoglobin_g_dl,
    lastDonationDate,
    daysSinceLastDonation: vitals.daysSinceLastDonation,
  };

  const result = checkEligibility(criteria);

  if (!result.eligible) {
    let deferredUntil = null;
    if (result.reason.includes('since last donation') && lastDonationDate) {
      const nextDate = new Date(new Date(lastDonationDate).getTime() + 90 * 24 * 60 * 60 * 1000);
      deferredUntil = nextDate.toISOString().split('T')[0];
    }

    await repository.updateEligibility(donor.id, {
      status: 'DEFERRED',
      deferralReason: result.reason,
      deferredUntil,
    });

    const error = new Error(result.reason);
    error.status = 422;
    error.eligible = false;
    error.statusString = 'DEFERRED';
    error.reason = result.reason;
    error.reasons = result.reasons;
    throw error;
  }

  await repository.updateEligibility(donor.id, {
    status: 'ELIGIBLE',
    deferralReason: null,
    deferredUntil: null,
  });

  return {
    eligible: true,
    status: 'ELIGIBLE',
    message: 'Donor is eligible to donate blood',
  };
}

module.exports = {
  validateDonorRegistration,
  registerDonor,
  recordConsent,
  resolveDateOfBirth,
  formatDonorCode,
  isValidDonorCode,
  parseDonorCode,
  calculateAge,
  checkEligibility,
  isEligible,
  evaluateDonorEligibility,
};
