const defaultRepository = require('./request.repository');

const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const VALID_COMPONENTS = ['WHOLE_BLOOD', 'PRBC', 'FFP', 'PLATELETS', 'CRYO'];
const VALID_PRIORITIES = ['ROUTINE', 'URGENT', 'EMERGENCY'];
const VALID_STATUSES = ['PENDING', 'RESERVED', 'ISSUED', 'REJECTED', 'CANCELLED'];
const MIN_UNITS = 1;
const MAX_UNITS = 20;

/**
 * Normalizes and validates blood request payload.
 * @param {object} input
 * @returns {{ isValid: boolean, errors: object, data: object }}
 */
function validateBloodRequestInput(input = {}) {
  const errors = {};

  // 1. Patient Name
  const rawPatientName = typeof input.patientName === 'string' ? input.patientName.trim() : '';
  if (!rawPatientName) {
    errors.patientName = 'Patient name is required';
  } else if (rawPatientName.length > 100) {
    errors.patientName = 'Patient name must not exceed 100 characters';
  }

  // 2. Patient Blood Group
  const rawBloodGroup = typeof input.patientBloodGroup === 'string' ? input.patientBloodGroup.trim().toUpperCase() : '';
  if (!rawBloodGroup) {
    errors.patientBloodGroup = 'Patient blood group is required';
  } else if (!VALID_BLOOD_GROUPS.includes(rawBloodGroup)) {
    errors.patientBloodGroup = `Valid patient blood group is required (${VALID_BLOOD_GROUPS.join(', ')})`;
  }

  // 3. Blood Component
  const rawComponent = typeof input.component === 'string' ? input.component.trim().toUpperCase() : '';
  if (!rawComponent) {
    errors.component = 'Blood component is required';
  } else if (!VALID_COMPONENTS.includes(rawComponent)) {
    errors.component = `Valid component is required (${VALID_COMPONENTS.join(', ')})`;
  }

  // 4. Units Requested (accepts unitsRequested or quantity)
  const rawUnits = input.unitsRequested !== undefined ? input.unitsRequested : input.quantity;
  const parsedUnits = Number(rawUnits);
  if (
    rawUnits === undefined ||
    rawUnits === null ||
    rawUnits === '' ||
    Number.isNaN(parsedUnits) ||
    !Number.isInteger(parsedUnits) ||
    parsedUnits < MIN_UNITS ||
    parsedUnits > MAX_UNITS
  ) {
    errors.unitsRequested = `Units requested must be a whole number between ${MIN_UNITS} and ${MAX_UNITS}`;
  }

  // 5. Priority / Urgency
  let priority = 'ROUTINE';
  if (input.priority !== undefined && input.priority !== null && input.priority !== '') {
    const rawPriority = String(input.priority).trim().toUpperCase();
    if (!VALID_PRIORITIES.includes(rawPriority)) {
      errors.priority = `Priority must be ${VALID_PRIORITIES.slice(0, -1).join(', ')}, or ${VALID_PRIORITIES[VALID_PRIORITIES.length - 1]}`;
    } else {
      priority = rawPriority;
    }
  }

  // 6. Required By (optional datetime)
  let requiredBy = null;
  if (input.requiredBy) {
    const parsedDate = new Date(input.requiredBy);
    if (Number.isNaN(parsedDate.getTime())) {
      errors.requiredBy = 'requiredBy must be a valid date or datetime';
    } else {
      requiredBy = parsedDate.toISOString();
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    data: {
      patientName: rawPatientName,
      patientBloodGroup: rawBloodGroup,
      component: rawComponent,
      unitsRequested: parsedUnits,
      priority,
      requiredBy,
    },
  };
}

/**
 * BBMS-F-040: Submits a new blood request on behalf of a hospital patient.
 * The request is assigned a unique Request ID (R-XXXXXX) with status 'PENDING'.
 * @param {object} input
 * @param {number} hospitalUserId
 * @param {object} [repository]
 * @returns {Promise<object>}
 */
async function submitBloodRequest(input, hospitalUserId, repository = defaultRepository) {
  if (!hospitalUserId) {
    const error = new Error('hospitalUserId is required to submit a request');
    error.status = 400;
    throw error;
  }

  const validation = validateBloodRequestInput(input);
  if (!validation.isValid) {
    const error = new Error('Validation failed');
    error.status = 400;
    error.errors = validation.errors;
    throw error;
  }

  const createdRequest = await repository.createRequest({
    hospitalUserId,
    ...validation.data,
    status: 'PENDING',
  });

  return createdRequest;
}

/**
 * Lists blood requests. Hospital users are restricted to their own hospital's requests.
 * @param {object} params
 * @param {object} params.user
 * @param {string} [params.status]
 * @param {string} [params.priority]
 * @param {object} [repository]
 * @returns {Promise<Array<object>>}
 */
async function getBloodRequests({ user, status = null, priority = null } = {}, repository = defaultRepository) {
  const isHospital = user?.role === 'HOSPITAL';
  const hospitalUserId = isHospital ? user.id : null;

  if (status && !VALID_STATUSES.includes(status.toUpperCase())) {
    const error = new Error(`Invalid status filter. Allowed: ${VALID_STATUSES.join(', ')}`);
    error.status = 400;
    throw error;
  }

  if (priority && !VALID_PRIORITIES.includes(priority.toUpperCase())) {
    const error = new Error(`Invalid priority filter. Allowed: ${VALID_PRIORITIES.join(', ')}`);
    error.status = 400;
    throw error;
  }

  return repository.listRequests({
    hospitalUserId,
    status: status ? status.toUpperCase() : null,
    priority: priority ? priority.toUpperCase() : null,
  });
}

/**
 * Retrieves a blood request by its ID or Code.
 * Enforces hospital tenancy: Hospital users can only view their own requests.
 * @param {number|string} idOrCode
 * @param {object} user
 * @param {object} [repository]
 * @returns {Promise<object>}
 */
async function getBloodRequestById(idOrCode, user, repository = defaultRepository) {
  const request = await repository.findByIdOrCode(idOrCode);
  if (!request) {
    const error = new Error(`Blood request '${idOrCode}' not found`);
    error.status = 404;
    throw error;
  }

  // Hospital tenancy check
  if (user?.role === 'HOSPITAL' && request.hospitalUserId !== user.id) {
    const error = new Error('Access forbidden: this blood request was submitted by another hospital');
    error.status = 403;
    throw error;
  }

  return request;
}

module.exports = {
  VALID_BLOOD_GROUPS,
  VALID_COMPONENTS,
  VALID_PRIORITIES,
  VALID_STATUSES,
  MIN_UNITS,
  MAX_UNITS,
  validateBloodRequestInput,
  submitBloodRequest,
  getBloodRequests,
  getBloodRequestById,
};
