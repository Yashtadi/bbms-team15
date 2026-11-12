const express = require('express');
const { requireRole } = require('../../middleware/auth');
const requestService = require('./request.service');
const inventoryService = require('../inventory/inventory.service');

const router = express.Router();

/**
 * BBMS-F-040: Hospital staff submits a blood request.
 * POST /api/blood-requests -> 201 { request }
 * Roles: HOSPITAL, ADMIN (others get 403).
 */
router.post('/', requireRole('HOSPITAL', 'ADMIN'), async (req, res) => {
  try {
    const created = await requestService.submitBloodRequest(req.body, req.user.id);
    return res.status(201).json(created);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        message: error.message,
        errors: error.errors || {},
      });
    }

    return res.status(500).json({
      message: 'Failed to submit blood request',
      error: error.message,
    });
  }
});

/**
 * BBMS-F-040: Lists blood requests.
 * GET /api/blood-requests -> 200 { requests: [...] }
 * Roles: HOSPITAL, MANAGER, ADMIN, LAB_TECH (DONOR gets 403).
 * HOSPITAL users only see their own hospital's requests.
 */
router.get('/', requireRole('HOSPITAL', 'MANAGER', 'ADMIN', 'LAB_TECH'), async (req, res) => {
  try {
    const { status, priority } = req.query;
    const requests = await requestService.getBloodRequests({
      user: req.user,
      status,
      priority,
    });
    return res.status(200).json({ requests });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({
      message: 'Failed to retrieve blood requests',
      error: error.message,
    });
  }
});

/**
 * BBMS-F-040: Get details of a single blood request by ID or code.
 * GET /api/blood-requests/:idOrCode -> 200 { request }
 * Roles: HOSPITAL, MANAGER, ADMIN, LAB_TECH (DONOR gets 403).
 */
router.get('/:idOrCode', requireRole('HOSPITAL', 'MANAGER', 'ADMIN', 'LAB_TECH'), async (req, res) => {
  try {
    const request = await requestService.getBloodRequestById(req.params.idOrCode, req.user);
    return res.status(200).json({ request });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ message: error.message });
    }
    if (error.status === 403) {
      return res.status(403).json({ message: error.message });
    }

    return res.status(500).json({
      message: 'Failed to retrieve blood request',
      error: error.message,
    });
  }
});

/**
 * BBMS-F-041: Record cross-match result for a blood request and blood unit.
 * POST /api/blood-requests/:idOrCode/crossmatch -> 201 { crossmatch }
 * Roles: LAB_TECH, MANAGER, ADMIN (others get 403).
 */
router.post('/:idOrCode/crossmatch', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { unitCode, result } = req.body;
    const crossmatch = await requestService.recordCrossmatch({
      idOrCode: req.params.idOrCode,
      unitCode,
      result,
      performedBy: req.user.id,
    });

    return res.status(201).json({ crossmatch });
  } catch (error) {
    if ([400, 404, 409, 422].includes(error.status)) {
      return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
    }

    return res.status(500).json({
      message: 'Failed to record cross-match',
      error: error.message,
    });
  }
});

/**
 * BBMS-F-041: List all cross-matches recorded for a blood request.
 * GET /api/blood-requests/:idOrCode/crossmatches -> 200 { request, crossmatches: [...] }
 * Roles: HOSPITAL, LAB_TECH, MANAGER, ADMIN
 */
router.get('/:idOrCode/crossmatches', requireRole('HOSPITAL', 'LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const result = await requestService.getCrossmatchesForRequest(req.params.idOrCode, req.user);
    return res.status(200).json(result);
  } catch (error) {
    if (error.status === 404 || error.status === 403) {
      return res.status(error.status).json({ message: error.message });
    }

    return res.status(500).json({
      message: 'Failed to retrieve cross-matches',
      error: error.message,
    });
  }
});

/**
 * BBMS-F-033: Suggest soonest-to-expire compatible units (FEFO) for a blood request.
 * GET /api/blood-requests/:idOrCode/fefo-suggestions -> 200 { requestCode, suggestedUnits, ... }
 * Roles: HOSPITAL, LAB_TECH, MANAGER, ADMIN
 */
router.get('/:idOrCode/fefo-suggestions', requireRole('HOSPITAL', 'LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const request = await requestService.getBloodRequestById(req.params.idOrCode, req.user);
    const fefo = await inventoryService.suggestFefoAllocation({
      patientBloodGroup: request.patientBloodGroup,
      component: request.component,
      unitsRequested: request.unitsRequested,
    });
    return res.status(200).json({
      requestId: request.id,
      requestCode: request.requestCode,
      patientName: request.patientName,
      ...fefo,
    });
  } catch (error) {
    if (error.status === 404 || error.status === 403 || error.status === 400) {
      return res.status(error.status).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to retrieve FEFO suggestions' });
  }
});

/**
 * BBMS-F-041: Check whether a specific blood unit is ready for issuance for this request.
 * GET /api/blood-requests/:idOrCode/crossmatch/:unitCode/check -> 200 { readyForIssuance: boolean, ... }
 * Roles: HOSPITAL, LAB_TECH, MANAGER, ADMIN
 */
router.get('/:idOrCode/crossmatch/:unitCode/check', requireRole('HOSPITAL', 'LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    // Check tenancy first if user is HOSPITAL
    await requestService.getBloodRequestById(req.params.idOrCode, req.user);

    const check = await requestService.checkIssuanceReadiness({
      idOrCode: req.params.idOrCode,
      unitCode: req.params.unitCode,
    });

    return res.status(200).json(check);
  } catch (error) {
    if (error.status === 404 || error.status === 403 || error.status === 400) {
      return res.status(error.status).json({ message: error.message });
    }

    return res.status(500).json({
      message: 'Failed to check issuance readiness',
      error: error.message,
    });
  }
});

// BBMS-F-042: maps a service error to the SAD status codes; anything unexpected is a 500
function sendReservationError(res, error, fallbackMessage) {
  if ([400, 403, 404, 409, 422].includes(error.status)) {
    const body = { message: error.message };
    if (error.code) body.code = error.code;
    if (error.errors) body.errors = error.errors;
    return res.status(error.status).json(body);
  }
  return res.status(500).json({ message: fallbackMessage, error: error.message });
}

/**
 * BBMS-F-042: Reserve a cross-matched unit for a request for a limited time.
 * POST /api/blood-requests/:idOrCode/reservations { unitCode, holdMinutes? } -> 201 { reservation }
 * Roles: LAB_TECH, MANAGER, ADMIN (HOSPITAL and DONOR get 403).
 */
router.post('/:idOrCode/reservations', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const reservation = await requestService.reserveUnitForRequest({
      idOrCode: req.params.idOrCode,
      body: req.body || {},
      user: req.user,
    });
    return res.status(201).json({ reservation });
  } catch (error) {
    return sendReservationError(res, error, 'Failed to reserve blood unit');
  }
});

/**
 * BBMS-F-042: Units currently held for a request.
 * GET /api/blood-requests/:idOrCode/reservations -> 200 { request, reservations: [...] }
 * Roles: HOSPITAL (own requests only), LAB_TECH, MANAGER, ADMIN.
 */
router.get('/:idOrCode/reservations', requireRole('HOSPITAL', 'LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const result = await requestService.getReservationsForRequest(req.params.idOrCode, req.user);
    return res.status(200).json(result);
  } catch (error) {
    return sendReservationError(res, error, 'Failed to retrieve reservations');
  }
});

/**
 * BBMS-F-042: Release a hold early; the unit goes back to AVAILABLE stock.
 * DELETE /api/blood-requests/:idOrCode/reservations/:unitCode -> 200 { released }
 * Roles: LAB_TECH, MANAGER, ADMIN (HOSPITAL and DONOR get 403).
 */
router.delete('/:idOrCode/reservations/:unitCode', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const released = await requestService.releaseUnitReservation({
      idOrCode: req.params.idOrCode,
      unitCode: req.params.unitCode,
      user: req.user,
    });
    return res.status(200).json({ released });
  } catch (error) {
    return sendReservationError(res, error, 'Failed to release reservation');
  }
});

module.exports = router;
