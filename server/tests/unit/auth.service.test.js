const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { login } = require('../../src/modules/auth/auth.service');
const repository = require('../../src/modules/auth/auth.repository');

jest.mock('../../src/modules/auth/auth.repository');

const PASSWORD = 'Password@123';
const fakeUser = {
  id: 3,
  email: 'labtech@bbms.test',
  password_hash: bcrypt.hashSync(PASSWORD, 4), // low cost = fast tests
  full_name: 'Lata LabTech',
  role: 'LAB_TECH',
  is_active: 1,
};

describe('TC-Sec-02: auth.service login (unit)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns a token with id and role, and the user without the password hash', async () => {
    repository.findUserByEmail.mockResolvedValue(fakeUser);

    const result = await login({ email: 'labtech@bbms.test', password: PASSWORD });

    expect(result.user).toEqual({ id: 3, email: 'labtech@bbms.test', fullName: 'Lata LabTech', role: 'LAB_TECH' });
    expect(result.user).not.toHaveProperty('password_hash');
    const payload = jwt.verify(result.token, process.env.JWT_SECRET);
    expect(payload).toMatchObject({ sub: 3, role: 'LAB_TECH' });
  });

  it('matches the email case-insensitively', async () => {
    repository.findUserByEmail.mockResolvedValue(fakeUser);

    await login({ email: '  LabTech@BBMS.test ', password: PASSWORD });

    expect(repository.findUserByEmail).toHaveBeenCalledWith('labtech@bbms.test');
  });

  it('rejects a wrong password with 401', async () => {
    repository.findUserByEmail.mockResolvedValue(fakeUser);

    await expect(login({ email: 'labtech@bbms.test', password: 'wrong' }))
      .rejects.toMatchObject({ status: 401, message: 'Invalid email or password' });
  });

  it('rejects an unknown email with the same 401 message', async () => {
    repository.findUserByEmail.mockResolvedValue(null);

    await expect(login({ email: 'nobody@bbms.test', password: PASSWORD }))
      .rejects.toMatchObject({ status: 401, message: 'Invalid email or password' });
  });

  it('rejects a deactivated account with 401', async () => {
    repository.findUserByEmail.mockResolvedValue({ ...fakeUser, is_active: 0 });

    await expect(login({ email: 'labtech@bbms.test', password: PASSWORD }))
      .rejects.toMatchObject({ status: 401 });
  });

  it('rejects a missing email or password with 400', async () => {
    await expect(login({ email: 'labtech@bbms.test' })).rejects.toMatchObject({ status: 400 });
    await expect(login({ password: PASSWORD })).rejects.toMatchObject({ status: 400 });
    await expect(login()).rejects.toMatchObject({ status: 400 });
  });
});
