const express = require('express');
const { requireRole } = require('../../middleware/auth');
const inventoryRepository = require('./inventory.repository');
const inventoryService = require('./inventory.service');

const router = express.Router();

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const COMPONENTS = ['WHOLE_BLOOD', 'PRBC', 'FFP', 'PLATELETS', 'CRYO'];

// BBMS-F-030: stock counts for the inventory dashboard. Blood-bank staff only
// (SAD §4.5: manager screens show inventory; hospitals see request status instead).
router.get('/summary', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const summary = await inventoryService.getStockSummary();
    return res.status(200).json(summary);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load inventory summary' });
  }
});

// Sends the 4xx a service error asks for, or 500 for anything unexpected
function sendServiceError(res, error, fallbackMessage) {
  if ([400, 404, 409, 422].includes(error.status)) {
    return res.status(error.status).json({
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.errors ? { errors: error.errors } : {}),
    });
  }
  return res.status(500).json({ message: fallbackMessage });
}

/**
 * BBMS-F-032: Expiry alerts for units nearing expiry (configurable threshold, default 3 days)
 * GET /api/inventory/alerts/expiry?thresholdDays=3
 * GET /api/inventory/expiry-alerts?thresholdDays=3
 * Authorized roles: LAB_TECH, MANAGER, ADMIN
 */
async function handleExpiryAlerts(req, res) {
  try {
    const rawThreshold = req.query.thresholdDays !== undefined ? req.query.thresholdDays : req.query.days;
    const thresholdDays = rawThreshold !== undefined ? rawThreshold : 3;
    const result = await inventoryService.getExpiryAlerts({ thresholdDays });
    return res.status(200).json(result);
  } catch (error) {
    return sendServiceError(res, error, 'Failed to load expiry alerts');
  }
}

router.get('/alerts/expiry', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), handleExpiryAlerts);
router.get('/expiry-alerts', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), handleExpiryAlerts);

/**
 * BBMS-F-034: Low-stock alerts for blood groups falling below safety threshold
 * GET /api/inventory/alerts/low-stock?threshold=3
 * GET /api/inventory/low-stock-alerts?threshold=3
 * Allowed roles: LAB_TECH, MANAGER, ADMIN
 */
async function handleLowStockAlerts(req, res) {
  try {
    const rawThreshold = req.query.threshold !== undefined ? req.query.threshold : req.query.minUnits;
    const threshold = rawThreshold !== undefined ? rawThreshold : 3;
    const { bloodGroup } = req.query;
    const result = await inventoryService.getLowStockAlerts({ threshold, bloodGroup });
    return res.status(200).json(result);
  } catch (error) {
    return sendServiceError(res, error, 'Failed to load low-stock alerts');
  }
}

router.get('/alerts/low-stock', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), handleLowStockAlerts);
router.get('/low-stock-alerts', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), handleLowStockAlerts);

/**
 * BBMS-F-033: FEFO allocation suggestion for issuance
 * GET /api/inventory/fefo?patientBloodGroup=A+&component=PRBC&unitsRequested=1
 * Allowed roles: LAB_TECH, MANAGER, ADMIN, HOSPITAL
 */
router.get('/fefo', requireRole('LAB_TECH', 'MANAGER', 'ADMIN', 'HOSPITAL'), async (req, res) => {
  try {
    const { patientBloodGroup, bloodGroup, component, unitsRequested, quantity, limit } = req.query;
    const result = await inventoryService.suggestFefoAllocation({
      patientBloodGroup: patientBloodGroup || bloodGroup,
      component,
      unitsRequested: unitsRequested || quantity || limit || 1,
    });
    return res.status(200).json(result);
  } catch (error) {
    return sendServiceError(res, error, 'Failed to suggest FEFO allocation');
  }
});

/**
 * BBMS-F-031: Separate a whole-blood unit into components
 * POST /api/inventory/units/:unitCode/separate { components: ['PRBC','FFP','PLATELETS'], volumes? }
 *   -> 201 { parent, children }
 * 400 bad input, 404 unknown unit, 409 already separated / not in the bank, 422 not whole blood
 * or a component that would already be expired. Blood-bank staff only.
 */
router.post('/units/:unitCode/separate', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const result = await inventoryService.separateUnit(req.params.unitCode, req.body, req.user.id);
    return res.status(201).json(result);
  } catch (error) {
    return sendServiceError(res, error, 'Failed to separate blood unit');
  }
});

/**
 * BBMS-F-031: Traceability of a unit
 * GET /api/inventory/units/:unitCode/lineage -> 200 { unit, parent, children, siblings, donation }
 */
router.get('/units/:unitCode/lineage', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const lineage = await inventoryService.getLineage(req.params.unitCode);
    return res.status(200).json(lineage);
  } catch (error) {
    return sendServiceError(res, error, 'Failed to load unit lineage');
  }
});

router.get('/', requireRole('LAB_TECH', 'MANAGER', 'HOSPITAL', 'ADMIN'), async (req, res) => {
  const { bloodGroup = null, component = null } = req.query;
  const invalidBloodGroup = bloodGroup !== null &&
    (typeof bloodGroup !== 'string' || !BLOOD_GROUPS.includes(bloodGroup));
  const invalidComponent = component !== null &&
    (typeof component !== 'string' || !COMPONENTS.includes(component));
  if (invalidBloodGroup || invalidComponent) {
    return res.status(400).json({
      message: 'Invalid inventory filter',
      errors: {
        ...(invalidBloodGroup
          ? { bloodGroup: `Blood group must be one of: ${BLOOD_GROUPS.join(', ')}` }
          : {}),
        ...(invalidComponent
          ? { component: `Component must be one of: ${COMPONENTS.join(', ')}` }
          : {}),
      },
    });
  }

  try {
    const units = await inventoryRepository.listAvailable({ bloodGroup, component });
    return res.status(200).json({ units });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load available inventory' });
  }
});

module.exports = router;
