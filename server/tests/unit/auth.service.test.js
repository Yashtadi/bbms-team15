const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { login, changePassword } = require('../../src/modules/auth/auth.service');
const repository = require('../../src/modules/auth/auth.repository');
const { generateTotp } = require('../../src/modules/auth/mfa.totp');
const { decrypt } = require('../../src/utils/encryption');

jest.mock('../../src/modules/auth/auth.repository');

const PASSWORD = 'Password@123';
const fakeUser = {
  id: 3,
  email: 'labtech@bbms.test',
  password_hash: bcrypt.hashSync(PASSWORD, 4), // low cost = fast tests
  full_name: 'Labtech 1',
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

    expect(result.user).toEqual({ id: 3, email: 'labtech@bbms.test', fullName: 'Labtech 1', role: 'LAB_TECH' });
    expect(result.user).not.toHaveProperty('password_hash');
    const payload = jwt.verify(result.token, process.env.JWT_SECRET);
    expect(payload).toMatchObject({ sub: 3, role: 'LAB_TECH' });
  });

  it('matches the email case-insensitively', async () => {
    repository.findUserByEmail.mockResolvedValue(fakeUser);

    await login({ email: '  LabTech@BBMS.test ', password: PASSWORD });

    expect(repository.findUserByEmail).toHaveBeenCalledWith('labtech@bbms.test');
  });

  it('falls back to finding user by donor code or phone if email search fails', async () => {
    repository.findUserByEmail.mockResolvedValue(null);
    repository.findUserByDonorCodeOrPhone = jest.fn().mockResolvedValue(fakeUser);

    const result = await login({ email: 'D-000001', password: PASSWORD });

    expect(repository.findUserByDonorCodeOrPhone).toHaveBeenCalledWith('D-000001');
    expect(result.user.id).toBe(3);
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

  it('requires privileged users to enroll in MFA before receiving an access token', async () => {
    const admin = { ...fakeUser, role: 'ADMIN', mfa_enabled: 0, mfa_secret: null };
    repository.findUserByEmail.mockResolvedValue(admin);

    const result = await login({ email: admin.email, password: PASSWORD });

    expect(result.mfaSetupRequired).toBe(true);
    expect(result.setupToken).toEqual(expect.any(String));
    expect(result).not.toHaveProperty('token');
  });

  it('requires an authenticator code at login after MFA enrollment', async () => {
    repository.findUserByEmail.mockResolvedValue({
      ...fakeUser,
      role: 'MANAGER',
      mfa_enabled: 1,
      mfa_secret: 'encrypted-secret',
    });

    const result = await login({ email: fakeUser.email, password: PASSWORD });

    expect(result.mfaRequired).toBe(true);
    expect(result.challengeToken).toEqual(expect.any(String));
    expect(result).not.toHaveProperty('token');
  });
});

describe('SR-005 MFA service flow (unit)', () => {
  const admin = { ...fakeUser, role: 'ADMIN', mfa_enabled: 0, mfa_secret: null };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('only returns a session after a valid setup code confirms the secret', async () => {
    const { beginMfaSetup, verifyMfaSetup } = require('../../src/modules/auth/auth.service');
    const jwt = require('jsonwebtoken');
    repository.findUserById.mockResolvedValue(admin);
    repository.updateMfaSecret.mockResolvedValue(true);
    repository.enableMfa.mockResolvedValue(true);
    repository.isMfaLocked.mockResolvedValue(false);
    repository.recordMfaFailure.mockResolvedValue(false);

    const setupToken = jwt.sign(
      { sub: admin.id, role: admin.role, purpose: 'mfa_setup' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    const setup = await beginMfaSetup({ setupToken });
    const savedSecret = decrypt(repository.updateMfaSecret.mock.calls[0][1]);
    repository.findUserById.mockResolvedValue({ ...admin, mfa_secret: repository.updateMfaSecret.mock.calls[0][1] });

    await expect(verifyMfaSetup({ setupToken, code: '000000' })).rejects.toMatchObject({ status: 401 });
    const session = await verifyMfaSetup({ setupToken, code: generateTotp(savedSecret) });

    expect(setup.secret).toBe(savedSecret);
    expect(setup.otpauthUrl).toContain(encodeURIComponent(admin.email));
    expect(repository.enableMfa).toHaveBeenCalledWith(admin.id);
    expect(session.token).toEqual(expect.any(String));
    expect(session.user.role).toBe('ADMIN');
  });

  it('locks MFA verification after five invalid codes', async () => {
    const { verifyMfa } = require('../../src/modules/auth/auth.service');
    const secret = 'JBSWY3DPEHPK3PXP';
    const challengeToken = jwt.sign(
      { sub: admin.id, role: admin.role, purpose: 'mfa_challenge' },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    repository.findUserById.mockResolvedValue({
      ...admin,
      mfa_enabled: 1,
      mfa_secret: require('../../src/utils/encryption').encrypt(secret),
    });
    repository.isMfaLocked.mockResolvedValue(false);
    repository.recordMfaFailure
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(verifyMfa({ challengeToken, code: 'not-a-code' }))
        .rejects.toMatchObject({ status: attempt === 4 ? 429 : 401 });
    }
    expect(repository.recordMfaFailure).toHaveBeenCalledTimes(5);
  });
});

describe('auth.service changePassword (unit)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('successfully updates password when credentials match', async () => {
    repository.findUserById = jest.fn().mockResolvedValue(fakeUser);
    repository.updatePassword = jest.fn().mockResolvedValue(true);

    const res = await changePassword({
      userId: 3,
      currentPassword: PASSWORD,
      newPassword: 'NewPassword@456',
      confirmPassword: 'NewPassword@456',
    });

    expect(res).toEqual({ message: 'Password updated successfully' });
    expect(repository.updatePassword).toHaveBeenCalledWith(3, expect.any(String));
  });

  it('rejects when new passwords do not match', async () => {
    await expect(
      changePassword({
        userId: 3,
        currentPassword: PASSWORD,
        newPassword: 'NewPassword@456',
        confirmPassword: 'DifferentPassword@789',
      })
    ).rejects.toMatchObject({ status: 400, message: 'New passwords do not match' });
  });

  it('rejects when current password is incorrect', async () => {
    repository.findUserById = jest.fn().mockResolvedValue(fakeUser);

    await expect(
      changePassword({
        userId: 3,
        currentPassword: 'WrongPassword',
        newPassword: 'NewPassword@456',
        confirmPassword: 'NewPassword@456',
      })
    ).rejects.toMatchObject({ status: 401, message: 'Current password is incorrect' });
  });
});
