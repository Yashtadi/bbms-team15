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

module.exports = router;
