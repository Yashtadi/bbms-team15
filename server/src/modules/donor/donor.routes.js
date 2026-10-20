const express = require('express');

const router = express.Router();

// Donor module: BBMS-F-001 to F-004
//
// Example of a protected route:
//   const { requireRole } = require('../../middleware/auth');
//   router.post('/', requireRole('LAB_TECH', 'ADMIN'), (req, res) => { ... });

module.exports = router;