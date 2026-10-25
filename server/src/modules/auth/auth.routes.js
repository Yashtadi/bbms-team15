const express = require('express');
const authService = require('./auth.service');

const router = express.Router();

// Auth module: login + roles (SR-002), MFA (SR-005)

/**
 * POST /api/auth/login
 * Body: { email, password }  →  200 { token, user } | 400 | 401
 * Public route: no requireRole here, because you can't have a token before logging in.
 */
router.post('/login', async (req, res) => {
  try {
    const result = await authService.login(req.body);
    return res.status(200).json(result);
  } catch (error) {
    if (error.status === 400 || error.status === 401) {
      return res.status(error.status).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Login failed' });
  }
});

module.exports = router;
