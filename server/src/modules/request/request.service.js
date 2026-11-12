const defaultRepository = require('./request.repository');
const { isBloodGroupCompatible } = require('./blood.compatibility');

const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const VALID_COMPONENTS = ['WHOLE_BLOOD', 'PRBC', 'FFP', 'PLATELETS', 'CRYO'];
const VALID_PRIORITIES = ['ROUTINE', 'URGENT', 'EMERGENCY'];
const VALID_STATUSES = ['PENDING', 'RESERVED', 'ISSUED', 'REJECTED', 'CANCELLED'];
const VALID_CROSSMATCH_RESULTS = ['COMPATIBLE', 'INCOMPATIBLE'];
const MIN_UNITS = 1;
const MAX_UNITS = 20;

// BBMS-F-042: reservation hold window in minutes (team assumption, see DEVIATIONS.md).
// The default can be changed with RESERVATION_HOLD_MINUTES; staff can override it per hold.
const DEFAULT_HOLD_MINUTES = 120;
const MIN_HOLD_MINUTES = 15;
const MAX_HOLD_MINUTES = 1440;
const RESERVABLE_REQUEST_STATUSES = ['PENDING', 'RESERVED'];
const RESERVATION_SWEEP_INTERVAL_MS = 60 * 1000;

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status }, extra);
}

function isWholeNumberInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * BBMS-F-042: Default hold window. An invalid or out-of-range RESERVATION_HOLD_MINUTES falls back
 * to 120 minutes, so a typo in .env can never create a zero-length or week-long hold.
 * @param {object} [env]
 * @returns {number}
 */
function getDefaultHoldMinutes(env = process.env) {
  const raw = env.RESERVATION_HOLD_MINUTES;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_HOLD_MINUTES;
  const parsed = Number(raw);
  return isWholeNumberInRange(parsed, MIN_HOLD_MINUTES, MAX_HOLD_MINUTES) ? parsed : DEFAULT_HOLD_MINUTES;
}

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

  // BBMS-F-042: a unit held for another request is excluded from other allocations
  if (isHeldForAnotherRequest(unit, request.id)) {
    throw httpError(409, `Unit ${unit.unit_code} is reserved for another blood request`, {
      code: 'RESERVED_FOR_OTHER_REQUEST',
    });
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

  // BBMS-F-042: a unit held for another request can't be issued against this one
  if (isHeldForAnotherRequest(unit, request.id)) {
    return {
      readyForIssuance: false,
      error: 'RESERVED_FOR_OTHER_REQUEST',
      requestCode: request.requestCode,
      unitCode: unit.unit_code,
      crossmatchId: crossmatch.id,
      result: 'COMPATIBLE',
      message: `Unit ${unit.unit_code} is reserved for another blood request. Issuance is blocked.`,
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

/**
 * BBMS-F-042: True when the unit is on an active hold for a request other than requestId.
 * A hold whose window has run out (reservation_active false) no longer blocks anyone.
 * @param {object} unit blood_units row
 * @param {number} requestId
 * @returns {boolean}
 */
function isHeldForAnotherRequest(unit, requestId) {
  if (!unit || unit.status !== 'RESERVED' || !unit.reserved_for_request_id) return false;
  if (unit.reserved_for_request_id === requestId) return false;
  if (unit.reservation_active === undefined || unit.reservation_active === null) return true;
  return Boolean(Number(unit.reservation_active));
}

/**
 * BBMS-F-042: Validates a reservation payload { unitCode, holdMinutes? }.
 * holdMinutes is optional; when given it must be a whole number of minutes from 15 to 1440.
 * @param {object} body
 * @param {object} [env]
 * @returns {{ isValid: boolean, errors: object, data: { unitCode: string, holdMinutes: number } }}
 */
function validateReservationInput(body = {}, env = process.env) {
  const errors = {};

  const unitCode = typeof body.unitCode === 'string' ? body.unitCode.trim().toUpperCase() : '';
  if (!unitCode) {
    errors.unitCode = 'Unit code is required';
  }

  let holdMinutes = getDefaultHoldMinutes(env);
  const rawHold = body.holdMinutes;
  if (rawHold !== undefined && rawHold !== null && rawHold !== '') {
    const parsed = typeof rawHold === 'string' ? Number(rawHold.trim()) : rawHold;
    if (typeof parsed !== 'number' || !isWholeNumberInRange(parsed, MIN_HOLD_MINUTES, MAX_HOLD_MINUTES)) {
      errors.holdMinutes = `Hold time must be a whole number of minutes between ${MIN_HOLD_MINUTES} and ${MAX_HOLD_MINUTES}`;
    } else {
      holdMinutes = parsed;
    }
  }

  return { isValid: Object.keys(errors).length === 0, errors, data: { unitCode, holdMinutes } };
}

/**
 * BBMS-F-042: Business rules for placing a hold, applied to the locked request and unit rows.
 * Throws an error with an HTTP status and a code when the hold is refused.
 * @param {object} context
 * @param {object} context.request locked blood_requests row
 * @param {object} context.unit locked blood_units row (reservation_active as boolean)
 * @param {boolean} context.isReleasable unit passes the F-022 release gate
 * @param {object|null} context.crossmatch latest cross-match for this request and unit
 * @param {number} context.activeCount active holds already on this request
 */
function planReservation({ request, unit, isReleasable, crossmatch, activeCount }) {
  if (!RESERVABLE_REQUEST_STATUSES.includes(request.status)) {
    throw httpError(409, `Units can't be reserved for a request that is ${request.status}`, {
      code: 'REQUEST_NOT_RESERVABLE',
    });
  }

  if (unit.status === 'RESERVED' && unit.reservation_active) {
    if (unit.reserved_for_request_id === request.id) {
      throw httpError(409, `Unit ${unit.unit_code} is already reserved for this request`, {
        code: 'ALREADY_RESERVED',
      });
    }
    throw httpError(409, `Unit ${unit.unit_code} is reserved for another blood request`, {
      code: 'RESERVED_FOR_OTHER_REQUEST',
    });
  }

  if (activeCount >= request.units_requested) {
    throw httpError(
      409,
      `Request ${request.request_code} already has ${activeCount} of ${request.units_requested} unit(s) reserved`,
      { code: 'RESERVATION_LIMIT_REACHED' }
    );
  }

  if (unit.component !== request.component) {
    throw httpError(422, `Unit ${unit.unit_code} is ${unit.component}, but the request is for ${request.component}`, {
      code: 'COMPONENT_MISMATCH',
    });
  }

  if (!isReleasable) {
    throw httpError(
      409,
      `Unit ${unit.unit_code} is not available stock (status ${unit.status}, or expired, or lab release incomplete)`,
      { code: 'UNIT_NOT_AVAILABLE' }
    );
  }

  if (!crossmatch) {
    throw httpError(422, `No cross-match recorded for unit ${unit.unit_code} on request ${request.request_code}`, {
      code: 'NO_CROSSMATCH',
    });
  }

  if (crossmatch.result !== 'COMPATIBLE') {
    throw httpError(422, `The latest cross-match for unit ${unit.unit_code} is ${crossmatch.result}`, {
      code: 'INCOMPATIBLE_CROSSMATCH',
    });
  }

  if (!isBloodGroupCompatible(request.patient_blood_group, unit.blood_group, request.component)) {
    throw httpError(
      422,
      `Unit blood group (${unit.blood_group}) is clinically incompatible with patient blood group (${request.patient_blood_group})`,
      { code: 'INCOMPATIBLE_BLOOD_GROUP' }
    );
  }
}

/**
 * BBMS-F-042: Reserves a cross-matched unit for a pending request for a limited time.
 * While held, the unit is excluded from stock counts, FEFO suggestions and other requests.
 * @param {object} params
 * @param {number|string} params.idOrCode
 * @param {object} params.body { unitCode, holdMinutes? }
 * @param {object} params.user req.user
 * @param {object} [repository]
 * @returns {Promise<object>}
 */
async function reserveUnitForRequest({ idOrCode, body, user }, repository = defaultRepository) {
  const validation = validateReservationInput(body);
  if (!validation.isValid) {
    throw httpError(400, 'Validation failed', { errors: validation.errors });
  }
  const { unitCode, holdMinutes } = validation.data;

  const request = await repository.findByIdOrCode(idOrCode);
  if (!request) throw httpError(404, `Blood request '${idOrCode}' not found`);

  await repository.releaseExpiredReservations();

  const result = await repository.reserveUnit(
    { requestId: request.id, unitCode, holdMinutes, userId: user.id },
    planReservation
  );
  if (result.requestNotFound) throw httpError(404, `Blood request '${idOrCode}' not found`);
  if (result.unitNotFound) throw httpError(404, `Blood unit '${unitCode}' not found`);

  return {
    requestId: request.id,
    requestCode: request.requestCode,
    requestStatus: result.request.status,
    unitsRequested: request.unitsRequested,
    activeReservations: result.activeReservations,
    unitId: result.unit.id,
    unitCode: result.unit.unit_code,
    component: result.unit.component,
    bloodGroup: result.unit.blood_group,
    crossmatchId: result.crossmatchId,
    holdMinutes,
    reservedUntil: result.reservedUntil ? new Date(result.reservedUntil).toISOString() : null,
    secondsRemaining: result.secondsRemaining,
    reservedBy: user.id,
  };
}

/**
 * BBMS-F-042: Releases a hold before its window ends; the unit goes back to AVAILABLE.
 * @returns {Promise<object>}
 */
async function releaseUnitReservation({ idOrCode, unitCode, user }, repository = defaultRepository) {
  const code = typeof unitCode === 'string' ? unitCode.trim().toUpperCase() : '';
  if (!code) throw httpError(400, 'Unit code is required');

  const request = await repository.findByIdOrCode(idOrCode);
  if (!request) throw httpError(404, `Blood request '${idOrCode}' not found`);

  const result = await repository.releaseReservation({ requestId: request.id, unitCode: code, userId: user.id });
  if (result.requestNotFound) throw httpError(404, `Blood request '${idOrCode}' not found`);
  if (result.unitNotFound) throw httpError(404, `Blood unit '${code}' not found`);
  if (result.notReserved) {
    throw httpError(409, `Unit ${code} is not reserved for request ${request.requestCode}`, {
      code: 'NOT_RESERVED',
    });
  }

  return {
    requestId: request.id,
    requestCode: request.requestCode,
    requestStatus: result.request.status,
    unitCode: result.unit.unit_code,
    unitStatus: 'AVAILABLE',
  };
}

/**
 * BBMS-F-042: Active holds on a request. Hospital users only see their own requests.
 * Lapsed holds are swept first, so the list never shows a hold that has run out.
 */
async function getReservationsForRequest(idOrCode, user, repository = defaultRepository) {
  const request = await getBloodRequestById(idOrCode, user, repository);
  await repository.releaseExpiredReservations();
  const reservations = await repository.listReservationsForRequest(request.id);
  const refreshed = (await repository.findByIdOrCode(request.id)) || request;
  return { request: refreshed, reservations };
}

/**
 * BBMS-F-042: Runs the lapsed-hold sweep on a timer (server only, never in tests).
 * The timer is unref'd, so it never keeps the process alive on shutdown.
 * @returns {NodeJS.Timeout}
 */
function startReservationExpirySweep({
  intervalMs = RESERVATION_SWEEP_INTERVAL_MS,
  repository = defaultRepository,
  logger = console,
} = {}) {
  const timer = setInterval(async () => {
    try {
      const released = await repository.releaseExpiredReservations();
      if (released.length > 0) {
        logger.log(`[F-042] Released ${released.length} lapsed reservation(s): ${released.map((r) => r.unitCode).join(', ')}`);
      }
    } catch (error) {
      logger.error('[F-042] Reservation expiry sweep failed:', error.message);
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  DEFAULT_HOLD_MINUTES,
  MIN_HOLD_MINUTES,
  MAX_HOLD_MINUTES,
  getDefaultHoldMinutes,
  isHeldForAnotherRequest,
  validateReservationInput,
  planReservation,
  reserveUnitForRequest,
  releaseUnitReservation,
  getReservationsForRequest,
  startReservationExpirySweep,
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
