// TEMPORARY STUB. Replaced with real JWT checks in issue SR-002.
//
// Use requireRole(...) on your routes NOW. Today it lets every request
// through; once SR-002 is merged it will start enforcing roles
// automatically, without you changing your code.

const ROLES = ['DONOR', 'LAB_TECH', 'MANAGER', 'HOSPITAL', 'ADMIN'];

function requireAuth(req, res, next) {
  next();
}

function requireRole(...roles) {
  // Catch typos early, e.g. 'LABTECH' instead of 'LAB_TECH'.
  roles.forEach((role) => {
    if (!ROLES.includes(role)) {
      throw new Error(`Unknown role "${role}". Use one of: ${ROLES.join(', ')}`);
    }
  });

  return (req, res, next) => next();
}

module.exports = { ROLES, requireAuth, requireRole };

