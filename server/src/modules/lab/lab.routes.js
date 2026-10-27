const express = require('express');
const { requireRole } = require('../../middleware/auth');
const labService = require('./lab.service');

const router = express.Router();

function handleError(res, error, fallbackMessage) {
  if ([400, 404, 409].includes(error.status)) {
    return res.status(error.status).json({
      message: error.message,
      ...(error.errors ? { errors: error.errors } : {}),
      ...(error.flagged ? { flagged: true } : {}),
    });
  }
  return res.status(500).json({ message: fallbackMessage });
}

router.post('/donations/:id/blood-group', requireRole('LAB_TECH'), async (req, res) => {
  try {
    const result = await labService.recordBloodGroup(req.params.id, req.body, req.user.id);
    return res.status(201).json(result);
  } catch (error) {
    return handleError(res, error, 'Failed to record blood group');
  }
});

router.post('/donations/:id/blood-group/verify', requireRole('LAB_TECH'), async (req, res) => {
  try {
    const result = await labService.verifyBloodGroup(req.params.id, req.body, req.user.id);
    return res.status(200).json(result);
  } catch (error) {
    return handleError(res, error, 'Failed to verify blood group');
  }
});

router.post('/donations/:id/tti-results', requireRole('LAB_TECH'), async (req, res) => {
  try {
    const result = await labService.recordTtiResult(req.params.id, req.body, req.user.id);
    return res.status(201).json(result);
  } catch (error) {
    return handleError(res, error, 'Failed to record TTI result');
  }
});

router.get('/notifications', requireRole('LAB_TECH', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const notifications = await labService.listNotifications(req.user.id);
    return res.status(200).json({ notifications });
  } catch (error) {
    return handleError(res, error, 'Failed to load notifications');
  }
});

module.exports = router;