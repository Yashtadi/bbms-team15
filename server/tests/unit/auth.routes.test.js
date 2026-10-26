const request = require('supertest');
const express = require('express');

const router = require('../../src/modules/auth/auth.routes');
const authService = require('../../src/modules/auth/auth.service');

jest.mock('../../src/modules/auth/auth.service');

describe('auth.routes: POST /api/auth/login error handling', () => {
  let app;
  let consoleErrorSpy;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/auth', router);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns 200 with token and user on success', async () => {
    authService.login.mockResolvedValue({ token: 'jwt-123', user: { id: 1, role: 'ADMIN' } });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bbms.test', password: 'Password@123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: 'jwt-123', user: { id: 1, role: 'ADMIN' } });
  });

  it('returns 401 on invalid credentials without calling console.error', async () => {
    const error = new Error('Invalid email or password');
    error.status = 401;
    authService.login.mockRejectedValue(error);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bbms.test', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('logs and returns descriptive 500 when an unexpected internal error occurs (e.g. DB or JWT failure)', async () => {
    const error = new Error('ECONNREFUSED 127.0.0.1:3306');
    authService.login.mockRejectedValue(error);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bbms.test', password: 'Password@123' });

    expect(res.status).toBe(500);
    expect(res.body.message).toContain('Server error during login');
    expect(consoleErrorSpy).toHaveBeenCalledWith('Login error (500):', error);
  });
});
