const labService = require('../../src/modules/lab/lab.service');

describe('BBMS-F-020 to F-023 lab service validation', () => {
  const repository = {
    recordBloodGroup: jest.fn(),
    recordTtiResult: jest.fn(),
    verifyBloodGroup: jest.fn(),
    listNotifications: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('normalises and stores ABO/Rh as one blood-group result', async () => {
    const result = { donationId: 11, bloodGroup: 'AB-', verificationStatus: 'PENDING' };
    repository.recordBloodGroup.mockResolvedValue(result);

    await expect(
      labService.recordBloodGroup('11', { aboGroup: ' ab ', rh: '-' }, 3, repository)
    ).resolves.toEqual(result);
    expect(repository.recordBloodGroup).toHaveBeenCalledWith(11, 'AB-', 3);
  });

  it('rejects invalid ABO or Rh values before reaching the repository', async () => {
    await expect(
      labService.recordBloodGroup(11, { aboGroup: 'C', rh: '+' }, 3, repository)
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.recordBloodGroup).not.toHaveBeenCalled();
  });

  it('keeps a mismatched verification unlocked and flags the failure', async () => {
    repository.verifyBloodGroup.mockResolvedValue({ mismatch: true });

    await expect(
      labService.verifyBloodGroup(11, { aboGroup: 'A', rh: '+' }, 4, repository)
    ).rejects.toMatchObject({ status: 409, flagged: true });
  });

  it('normalises valid TTI screening results and methods', async () => {
    const result = { donationId: 11, testType: 'SYPHILIS', result: 'NON_REACTIVE', method: 'NAT' };
    repository.recordTtiResult.mockResolvedValue(result);

    await expect(
      labService.recordTtiResult(
        '11',
        { testType: 'syphilis', result: 'non-reactive', method: 'nat' },
        3,
        repository
      )
    ).resolves.toEqual(result);
    expect(repository.recordTtiResult).toHaveBeenCalledWith(11, {
      testType: 'SYPHILIS',
      result: 'NON_REACTIVE',
      method: 'NAT',
      testedBy: 3,
    });
  });

  it.each([
    [{ testType: 'COVID', result: 'REACTIVE', method: 'ELISA' }, 'testType'],
    [{ testType: 'HIV', result: 'INDETERMINATE', method: 'ELISA' }, 'result'],
    [{ testType: 'HIV', result: 'REACTIVE', method: 'RAPID' }, 'method'],
  ])('rejects invalid TTI values (%j)', async (input, field) => {
    await expect(labService.recordTtiResult(11, input, 3, repository))
      .rejects.toMatchObject({ status: 400, errors: { [field]: expect.any(String) } });
    expect(repository.recordTtiResult).not.toHaveBeenCalled();
  });

  it('rejects a second record for an already-entered test', async () => {
    repository.recordTtiResult.mockRejectedValue({ code: 'ER_DUP_ENTRY' });

    await expect(
      labService.recordTtiResult(
        11,
        { testType: 'HIV', result: 'REACTIVE', method: 'ELISA' },
        3,
        repository
      )
    ).rejects.toMatchObject({ status: 409 });
  });
});
