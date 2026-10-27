const request = require('supertest');
const express = require('express');

const labRouter = require('../../src/modules/lab/lab.routes');
const labService = require('../../src/modules/lab/lab.service');
const { authHeader } = require('../helpers/auth');

jest.mock('../../src/modules/lab/lab.service');

describe('BBMS-F-020 to F-023 lab routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/lab', labRouter);
    jest.clearAllMocks();
  });

  it('requires an authenticated LAB_TECH to enter blood groups', async () => {
    const response = await request(app)
      .post('/api/lab/donations/12/blood-group')
      .send({ aboGroup: 'A', rh: '+' });
    expect(response.status).toBe(401);
    expect(labService.recordBloodGroup).not.toHaveBeenCalled();
  });

  it('uses the authenticated technician for blood-group entry', async () => {
    labService.recordBloodGroup.mockResolvedValue({
      donationId: 12,
      bloodGroup: 'A+',
      verificationStatus: 'PENDING',
    });

    const response = await request(app)
      .post('/api/lab/donations/12/blood-group').set(authHeader('LAB_TECH'))
      .send({ aboGroup: 'A', rh: '+' });

    expect(response.status).toBe(201);
    expect(labService.recordBloodGroup).toHaveBeenCalledWith(
      '12',
      { aboGroup: 'A', rh: '+' },
      3
    );
  });

  it('returns 409 and a flag when ABO/Rh verification mismatches', async () => {
    labService.verifyBloodGroup.mockRejectedValue(
      Object.assign(new Error('Blood-group verification did not match'), {
        status: 409,
        flagged: true,
      })
    );

    const response = await request(app)
      .post('/api/lab/donations/12/blood-group/verify').set(authHeader('LAB_TECH'))
      .send({ aboGroup: 'B', rh: '-' });

    expect(response.status).toBe(409);
    expect(response.body.flagged).toBe(true);
  });

  it('allows authorized staff to read only their own notification collection', async () => {
    labService.listNotifications.mockResolvedValue([{ id: 8, event_type: 'REACTIVE_TTI' }]);

    const response = await request(app)
      .get('/api/lab/notifications').set(authHeader('MANAGER'));

    expect(response.status).toBe(200);
    expect(response.body.notifications).toHaveLength(1);
    expect(labService.listNotifications).toHaveBeenCalledWith(2);
  });

  it.each(['DONOR', 'HOSPITAL'])('%s cannot read confidential notifications', async (role) => {
    const response = await request(app)
      .get('/api/lab/notifications').set(authHeader(role));

    expect(response.status).toBe(403);
    expect(labService.listNotifications).not.toHaveBeenCalled();
  });
});
