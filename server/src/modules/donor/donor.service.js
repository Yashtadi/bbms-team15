const defaultRepository = require('./donor.repository');

/**
 * Validates donor registration input.
 * Acceptance criteria:
 * - captures name, age, gender, contact, ID proof and medical history
 * - required fields validated; invalid input returns field-level messages
 * 
 * @param {object} input
 * @returns {{ isValid: boolean, errors: Record<string, string> }}
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
 * @param {number|null} age
 * @param {string|null} dateOfBirth
 * @returns {string}
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
 * Registers a new donor following BBMS-F-001 (SRS §4.1, SAD §4.3).
 * @param {object} input
 * @param {object} repository Optional dependency injection for testing
 * @returns {Promise<{ donorId: string, status: string }>}
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

  // Check duplicate ID proof (AC: Registering twice with the same ID proof is rejected with 409)
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
  });

  return {
    donorId: donorCode,
    status: 'PENDING',
  };
}

module.exports = {
  validateDonorRegistration,
  registerDonor,
  resolveDateOfBirth,
};
