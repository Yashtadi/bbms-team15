const jwt = require('jsonwebtoken');
const { requireAuth, requireRole } = require('../../src/middleware/auth');
const { tokenFor } = require('../helpers/auth');

// Fake Express objects, so the middleware can be tested without a server.
function mockReq(authorization) {
  return { headers: authorization ? { authorization } : {} };
}

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('TC-Sec-02: requireAuth (unit)', () => {
  it('rejects a request with no token (401)', () => {
    const res = mockRes();
    const next = jest.fn();

    requireAuth(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a header without the "Bearer " prefix (401)', () => {
    const res = mockRes();
    const next = jest.fn();

    requireAuth(mockReq(tokenFor('ADMIN')), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token signed with a different secret (401)', () => {
    const forged = jwt.sign({ sub: 1, role: 'ADMIN' }, 'not-the-real-secret');
    const res = mockRes();
    const next = jest.fn();

    requireAuth(mockReq(`Bearer ${forged}`), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an expired token (401)', () => {
    const expired = jwt.sign(
      { sub: 1, role: 'ADMIN', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET
    );
    const res = mockRes();
    const next = jest.fn();

    requireAuth(mockReq(`Bearer ${expired}`), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid token and sets req.user', () => {
    const req = mockReq(`Bearer ${tokenFor('LAB_TECH')}`);
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ id: 3, role: 'LAB_TECH' });
  });
});

describe('TC-Sec-02: requireRole (unit)', () => {
  it('throws on a misspelled role name when the route is defined', () => {
    expect(() => requireRole('LABTECH')).toThrow('Unknown role');
  });

  it('allows a user whose role is in the list', () => {
    const res = mockRes();
    const next = jest.fn();

    requireRole('LAB_TECH', 'ADMIN')(mockReq(`Bearer ${tokenFor('LAB_TECH')}`), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks a user whose role is not in the list (403)', () => {
    const res = mockRes();
    const next = jest.fn();

    requireRole('LAB_TECH', 'ADMIN')(mockReq(`Bearer ${tokenFor('HOSPITAL')}`), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401, not 403, when there is no token at all', () => {
    const res = mockRes();
    const next = jest.fn();

    requireRole('ADMIN')(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
