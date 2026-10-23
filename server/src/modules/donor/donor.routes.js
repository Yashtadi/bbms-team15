const express = require('express');
const { requireRole } = require('../../middleware/auth');
const donorService = require('./donor.service');

const router = express.Router();

/**
 * BBMS-F-001: Donor registration
 * SAD §4.3: POST /api/donors -> 201 { donorId, status }
 */
router.post('/', requireRole('DONOR', 'LAB_TECH', 'ADMIN'), async (req, res) => {
  try {
    const result = await donorService.registerDonor(req.body);
    return res.status(201).json(result);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        message: error.message,
        errors: error.errors || {},
      });
    }

    if (error.status === 409 || error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: error.message || 'A donor with this ID proof is already registered',
      });
    }

    return res.status(500).json({
      message: 'Failed to register donor',
      error: error.message,
    });
  }
});

module.exports = router;
