const defaultRepository = require('./request.repository');
const { isBloodGroupCompatible } = require('./blood.compatibility');

const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const VALID_COMPONENTS = ['WHOLE_BLOOD', 'PRBC', 'FFP', 'PLATELETS', 'CRYO'];
const VALID_PRIORITIES = ['ROUTINE', 'URGENT', 'EMERGENCY'];
const VALID_STATUSES = ['PENDING', 'RESERVED', 'ISSUED', 'REJECTED', 'CANCELLED'];
const VALID_CROSSMATCH_RESULTS = ['COMPATIBLE', 'INCOMPATIBLE'];
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

/**
 * BBMS-F-041: Records a cross-match result between a blood request patient and a blood unit.
 * Validates clinical compatibility, unit status (not quarantine, discarded, or expired).
 * A unit can only be marked ready for issuance after a cross-match result is COMPATIBLE.
 *
 * @param {object} params
 * @param {number|string} params.idOrCode Request ID or code (e.g. 'R-000001')
 * @param {string} params.unitCode Blood unit code (e.g. 'U-000001')
 * @param {'COMPATIBLE'|'INCOMPATIBLE'} params.result
 * @param {number} params.performedBy User ID of technician
 * @param {object} [repository]
 * @returns {Promise<object>}
 */
async function recordCrossmatch({ idOrCode, unitCode, result, performedBy }, repository = defaultRepository) {
  if (!idOrCode) {
    const error = new Error('Request ID or code is required');
    error.status = 400;
    throw error;
  }

  if (!unitCode || typeof unitCode !== 'string' || !unitCode.trim()) {
    const error = new Error('Unit code is required');
    error.status = 400;
    throw error;
  }

  const normalizedResult = typeof result === 'string' ? result.trim().toUpperCase() : '';
  if (!VALID_CROSSMATCH_RESULTS.includes(normalizedResult)) {
    const error = new Error(`Result must be ${VALID_CROSSMATCH_RESULTS.join(' or ')}`);
    error.status = 400;
    throw error;
  }

  const request = await repository.findByIdOrCode(idOrCode);
  if (!request) {
    const error = new Error(`Blood request '${idOrCode}' not found`);
    error.status = 404;
    throw error;
  }

  if (request.status === 'CANCELLED' || request.status === 'REJECTED') {
    const error = new Error(`Cannot record cross-match for a ${request.status.toLowerCase()} blood request`);
    error.status = 422;
    throw error;
  }

  const unit = await repository.findUnitByCode(unitCode.trim());
  if (!unit) {
    const error = new Error(`Blood unit '${unitCode}' not found`);
    error.status = 404;
    throw error;
  }

  // Unit eligibility checks
  if (unit.status === 'DISCARDED') {
    const error = new Error(`Unit ${unit.unit_code} has been discarded and cannot be cross-matched`);
    error.status = 422;
    throw error;
  }

  if (unit.status === 'QUARANTINE') {
    const error = new Error(`Unit ${unit.unit_code} is in quarantine and cannot be cross-matched`);
    error.status = 422;
    throw error;
  }

  if (unit.expires_at && new Date(unit.expires_at) < new Date()) {
    const error = new Error(`Unit ${unit.unit_code} has expired and cannot be cross-matched`);
    error.status = 422;
    throw error;
  }

  // Clinical ABO/Rh compatibility rule check
  const isCompatibleByGroup = isBloodGroupCompatible(request.patientBloodGroup, unit.blood_group, request.component);
  if (normalizedResult === 'COMPATIBLE' && !isCompatibleByGroup) {
    const error = new Error(
      `Unit blood group (${unit.blood_group}) is clinically incompatible with patient blood group (${request.patientBloodGroup}) for component ${request.component}; cannot record as COMPATIBLE`
    );
    error.status = 422;
    throw error;
  }

  const created = await repository.createCrossmatch({
    requestId: request.id,
    unitId: unit.id,
    result: normalizedResult,
    performedBy,
  });

  return {
    id: created.id,
    requestId: request.id,
    requestCode: request.requestCode,
    unitId: unit.id,
    unitCode: unit.unit_code,
    result: normalizedResult,
    readyForIssuance: normalizedResult === 'COMPATIBLE',
    performedBy,
    performedAt: created.performedAt,
  };
}

/**
 * BBMS-F-041: Checks whether a specific blood unit is ready for issuance for a request.
 * Issuance is blocked unless a cross-match result is COMPATIBLE.
 *
 * @param {object} params
 * @param {number|string} params.idOrCode
 * @param {string} params.unitCode
 * @param {object} [repository]
 * @returns {Promise<object>}
 */
async function checkIssuanceReadiness({ idOrCode, unitCode }, repository = defaultRepository) {
  if (!idOrCode) {
    const error = new Error('Request ID or code is required');
    error.status = 400;
    throw error;
  }

  if (!unitCode || typeof unitCode !== 'string' || !unitCode.trim()) {
    const error = new Error('Unit code is required');
    error.status = 400;
    throw error;
  }

  const request = await repository.findByIdOrCode(idOrCode);
  if (!request) {
    const error = new Error(`Blood request '${idOrCode}' not found`);
    error.status = 404;
    throw error;
  }

  const unit = await repository.findUnitByCode(unitCode.trim());
  if (!unit) {
    const error = new Error(`Blood unit '${unitCode}' not found`);
    error.status = 404;
    throw error;
  }

  const crossmatch = await repository.findLatestCrossmatch(request.id, unit.id);

  if (!crossmatch) {
    return {
      readyForIssuance: false,
      error: 'NO_CROSSMATCH',
      requestCode: request.requestCode,
      unitCode: unit.unit_code,
      message: `No cross-match test recorded for unit ${unit.unit_code} and request ${request.requestCode}. Issuance is blocked.`,
    };
  }

  if (crossmatch.result !== 'COMPATIBLE') {
    return {
      readyForIssuance: false,
      error: 'INCOMPATIBLE_CROSSMATCH',
      requestCode: request.requestCode,
      unitCode: unit.unit_code,
      crossmatchId: crossmatch.id,
      result: crossmatch.result,
      performedAt: crossmatch.performedAt,
      message: `Cross-match result for unit ${unit.unit_code} is ${crossmatch.result}. Issuance is blocked.`,
    };
  }

  // Check unit availability
  if (unit.status === 'DISCARDED' || unit.status === 'QUARANTINE') {
    return {
      readyForIssuance: false,
      error: 'INVALID_UNIT_STATUS',
      requestCode: request.requestCode,
      unitCode: unit.unit_code,
      crossmatchId: crossmatch.id,
      result: 'COMPATIBLE',
      message: `Unit ${unit.unit_code} is in status ${unit.status}. Issuance is blocked.`,
    };
  }

  if (unit.expires_at && new Date(unit.expires_at) < new Date()) {
    return {
      readyForIssuance: false,
      error: 'EXPIRED_UNIT',
      requestCode: request.requestCode,
      unitCode: unit.unit_code,
      crossmatchId: crossmatch.id,
      result: 'COMPATIBLE',
      message: `Unit ${unit.unit_code} has expired. Issuance is blocked.`,
    };
  }

  return {
    readyForIssuance: true,
    requestCode: request.requestCode,
    unitCode: unit.unit_code,
    crossmatchId: crossmatch.id,
    result: 'COMPATIBLE',
    performedAt: crossmatch.performedAt,
    message: `Unit ${unit.unit_code} is cross-match compatible with patient ${request.patientName} and ready for issuance.`,
  };
}

/**
 * BBMS-F-041: Retrieves all cross-match records for a blood request.
 * Enforces hospital tenancy.
 *
 * @param {number|string} idOrCode
 * @param {object} user
 * @param {object} [repository]
 * @returns {Promise<Array<object>>}
 */
async function getCrossmatchesForRequest(idOrCode, user, repository = defaultRepository) {
  const request = await getBloodRequestById(idOrCode, user, repository);
  const crossmatches = await repository.listCrossmatchesForRequest(request.id);
  return {
    request,
    crossmatches,
  };
}

module.exports = {
  VALID_BLOOD_GROUPS,
  VALID_COMPONENTS,
  VALID_PRIORITIES,
  VALID_STATUSES,
  VALID_CROSSMATCH_RESULTS,
  MIN_UNITS,
  MAX_UNITS,
  validateBloodRequestInput,
  submitBloodRequest,
  getBloodRequests,
  getBloodRequestById,
  recordCrossmatch,
  checkIssuanceReadiness,
  getCrossmatchesForRequest,
};
