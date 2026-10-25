// SR-002: authentication (who are you?) and role checks (are you allowed?).
//
// Put requireRole(...) on every protected route. It checks the token AND the role,
// so you don't need requireAuth as well:
//   router.post('/', requireRole('LAB_TECH', 'ADMIN'), handler);
// Use requireAuth on its own for routes that any logged-in user may call.
// After either one runs, req.user = { id, role } is available in your route.

const jwt = require('jsonwebtoken');

const ROLES = ['DONOR', 'LAB_TECH', 'MANAGER', 'HOSPITAL', 'ADMIN'];

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Login required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  // Catch typos early, e.g. 'LABTECH' instead of 'LAB_TECH'.
  roles.forEach((role) => {
    if (!ROLES.includes(role)) {
      throw new Error(`Unknown role "${role}". Use one of: ${ROLES.join(', ')}`);
    }
  });

  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'You do not have permission to do this' });
      }
      return next();
    });
  };
}

module.exports = { ROLES, requireAuth, requireRole };
