const express = require('express');
const { requireRole } = require('../../middleware/auth');
const collectionService = require('./collection.service');

const router = express.Router();

/**
 * BBMS-F-004 / BBMS-F-010: Start a donation session
 * SAD §4.3: POST /api/donations -> 201 { donationId, donorId, status, ..., unit }
 * Only LAB_TECH may record sessions (F-010), so other roles get 403.
 * Returns 422 if the donor has not given consent or is not eligible.
 * The staff ID is always the logged-in user, never taken from the request body.
 */
router.post('/', requireRole('LAB_TECH'), async (req, res) => {
  try {
    const result = await collectionService.startDonation({ ...req.body, staffId: req.user.id });
    return res.status(201).json(result);
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ message: error.message || 'Donor not found' });
    }

    if (error.status === 422) {
      return res.status(422).json({
        message: error.message,
        code: error.code || 'CONSENT_REQUIRED',
      });
    }

    if (error.status === 400) {
      return res.status(400).json({ message: error.message, errors: error.errors || {} });
    }

    return res.status(500).json({
      message: 'Failed to create donation session',
      error: error.message,
    });
  }
});

/**
 * BBMS-F-011: Record pre- or post-donation vitals for a session
 * PUT /api/donations/:id/vitals/pre|post -> 200 { donationId, phase, vitals, warnings }
 * Only LAB_TECH may record vitals (same as sessions). Out-of-safe-range readings are
 * stored and listed in `warnings`. Invalid readings get 400, an unknown session 404.
 */
function recordVitalsHandler(phase) {
  return async (req, res) => {
    try {
      const result = await collectionService.recordVitals(req.params.id, phase, req.body);
      return res.status(200).json(result);
    } catch (error) {
      if (error.status === 404) {
        return res.status(404).json({ message: error.message || 'Donation not found' });
      }

      if (error.status === 400) {
        return res.status(400).json({ message: error.message, errors: error.errors || {} });
      }

      return res.status(500).json({
        message: 'Failed to record vitals',
        error: error.message,
      });
    }
  };
}

router.put('/:id/vitals/pre', requireRole('LAB_TECH'), recordVitalsHandler('PRE'));
router.put('/:id/vitals/post', requireRole('LAB_TECH'), recordVitalsHandler('POST'));

/**
 * BBMS-F-012: Look up a blood unit by its barcode (scanned or typed unit ID)
 * GET /api/donations/units/:unitId -> 200 { unitId, barcode, bloodGroup, collectedAt, ... }
 * LAB_TECH prints labels; MANAGER and ADMIN may also look units up. Others get 403.
 * A malformed code gets 400, an unknown one 404.
 */
router.get('/units/:unitId', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const unit = await collectionService.getUnitByBarcode(req.params.unitId);
    return res.status(200).json(unit);
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ message: error.message || 'Blood unit not found' });
    }

    if (error.status === 400) {
      return res.status(400).json({ message: error.message, errors: error.errors || {} });
    }

    return res.status(500).json({
      message: 'Failed to look up blood unit',
      error: error.message,
    });
  }
});

module.exports = router;
