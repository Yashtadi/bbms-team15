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

    if (error.status === 409) {
      return res.status(409).json({
        message: error.message || 'A donor with this ID proof is already registered',
      });
    }

    if (error.code === 'ER_DUP_ENTRY') {
      const isIdProofDuplicate = /id_proof/i.test(error.sqlMessage || error.message || '');
      if (isIdProofDuplicate) {
        return res.status(409).json({
          message: 'A donor with this ID proof is already registered',
        });
      }
      return res.status(500).json({
        message: 'Failed to register donor',
        error: error.message,
      });
    }

    return res.status(500).json({
      message: 'Failed to register donor',
      error: error.message,
    });
  }
});

/**
 * BBMS-F-004: Digitally capture and record donor consent
 * SAD §4.3: POST /api/donors/:id/consent -> 200 { donorId, consentGiven: true, consentAt }
 */
router.post('/:id/consent', requireRole('DONOR', 'LAB_TECH', 'ADMIN'), async (req, res) => {
  try {
    const consent = req.body.consent !== undefined 
      ? req.body.consent 
      : req.body.consentGiven !== undefined 
        ? req.body.consentGiven 
        : true;

    const result = await donorService.recordConsent(req.params.id, consent);
    return res.status(200).json({
      ...result,
      message: 'Consent digitally recorded',
    });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ message: error.message || 'Donor not found' });
    }

    if (error.status === 400) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({
      message: 'Failed to record donor consent',
      error: error.message,
    });
  }
});

/**
 * BBMS-F-002: Evaluate donor eligibility by donor ID
 * SAD §4.3: POST /api/donors/:id/eligibility -> 200 { eligible, status } or 422 { eligible: false, reason }
 */
router.post('/:id/eligibility', requireRole('LAB_TECH', 'ADMIN'), async (req, res) => {
  try {
    const result = await donorService.evaluateDonorEligibility(req.params.id, req.body);
    return res.status(200).json(result);
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ message: error.message || 'Donor not found' });
    }

    if (error.status === 422) {
      return res.status(422).json({
        eligible: false,
        status: 'DEFERRED',
        reason: error.reason || error.message,
        reasons: error.reasons || [error.message],
        message: error.message,
      });
    }

    if (error.status === 400) {
      return res.status(400).json({ message: error.message, errors: error.errors });
    }

    return res.status(500).json({
      message: 'Failed to evaluate donor eligibility',
      error: error.message,
    });
  }
});

/**
 * BBMS-F-002: Check eligibility with provided vitals directly or via donorId in body
 * SAD §4.3: POST /api/donors/eligibility -> 200 or 422
 */
router.post('/eligibility', requireRole('LAB_TECH', 'ADMIN'), async (req, res) => {
  try {
    const { donorId, ...vitals } = req.body;

    if (donorId) {
      const result = await donorService.evaluateDonorEligibility(donorId, vitals);
      return res.status(200).json(result);
    }

    const result = donorService.checkEligibility(req.body);
    if (!result.eligible) {
      return res.status(422).json({
        eligible: false,
        status: 'DEFERRED',
        reason: result.reason,
        reasons: result.reasons,
        message: result.reason,
      });
    }

    return res.status(200).json({
      eligible: true,
      status: 'ELIGIBLE',
      message: 'Donor is eligible to donate blood',
    });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ message: error.message || 'Donor not found' });
    }

    if (error.status === 422) {
      return res.status(422).json({
        eligible: false,
        status: 'DEFERRED',
        reason: error.reason || error.message,
        reasons: error.reasons || [error.message],
        message: error.message,
      });
    }

    return res.status(500).json({
      message: 'Failed to evaluate donor eligibility',
      error: error.message,
    });
  }
});

module.exports = router;
