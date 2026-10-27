const defaultLabRepository = require('./lab.repository');

const ABO_GROUPS = ['A', 'B', 'AB', 'O'];
const RH_FACTORS = ['+', '-'];
const TTI_TESTS = ['HIV', 'HBV', 'HCV', 'SYPHILIS', 'MALARIA'];
const TTI_RESULTS = ['REACTIVE', 'NON_REACTIVE'];
const TEST_METHODS = ['NAT', 'ELISA'];

function serviceError(message, status, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function parseDonationId(rawId) {
  const donationId = Number(rawId);
  if (!Number.isSafeInteger(donationId) || donationId <= 0) {
    throw serviceError('Donation ID must be a positive integer', 400);
  }
  return donationId;
}

function bloodGroupFromInput(input = {}) {
  const aboGroup = typeof input.aboGroup === 'string' ? input.aboGroup.trim().toUpperCase() : '';
  const rh = typeof input.rh === 'string' ? input.rh.trim() : '';
  if (!ABO_GROUPS.includes(aboGroup) || !RH_FACTORS.includes(rh)) {
    throw serviceError('ABO group must be A, B, AB, or O and Rh must be + or -', 400);
  }
  return `${aboGroup}${rh}`;
}

function normaliseTtiInput(input = {}) {
  const testType = typeof input.testType === 'string'
    ? input.testType.trim().toUpperCase().replace(/[\s-]+/g, '_')
    : '';
  const result = typeof input.result === 'string' ? input.result.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
  const method = typeof input.method === 'string' ? input.method.trim().toUpperCase() : '';
  const errors = {};

  if (!TTI_TESTS.includes(testType)) errors.testType = `Test type must be one of: ${TTI_TESTS.join(', ')}`;
  if (!TTI_RESULTS.includes(result)) errors.result = `Result must be one of: ${TTI_RESULTS.join(', ')}`;
  if (!TEST_METHODS.includes(method)) errors.method = `Method must be one of: ${TEST_METHODS.join(', ')}`;
  if (Object.keys(errors).length > 0) {
    throw serviceError('Validation failed', 400, { errors });
  }
  return { testType, result, method };
}

function throwForRepositoryResult(result) {
  if (result.notFound) throw serviceError('Donation or blood unit not found', 404);
  if (result.resultNotFound) throw serviceError('Blood group result not found', 404);
  if (result.sameUser) throw serviceError('A different lab technician must verify the blood group', 409);
  if (result.locked) throw serviceError('A verified blood group cannot be edited', 409);
  if (result.mismatch) {
    throw serviceError('Blood-group verification did not match; the result remains unlocked and is flagged', 409, {
      flagged: true,
    });
  }
}

function mapDuplicate(error) {
  if (error.code === 'ER_DUP_ENTRY') {
    throw serviceError('A result has already been recorded for this test', 409);
  }
  throw error;
}

async function recordBloodGroup(rawDonationId, input, testedBy, repository = defaultLabRepository) {
  const donationId = parseDonationId(rawDonationId);
  const bloodGroup = bloodGroupFromInput(input);
  try {
    const result = await repository.recordBloodGroup(donationId, bloodGroup, testedBy);
    throwForRepositoryResult(result);
    return result;
  } catch (error) {
    mapDuplicate(error);
  }
}

async function verifyBloodGroup(rawDonationId, input, verifiedBy, repository = defaultLabRepository) {
  const donationId = parseDonationId(rawDonationId);
  const bloodGroup = bloodGroupFromInput(input);
  const result = await repository.verifyBloodGroup(donationId, bloodGroup, verifiedBy);
  throwForRepositoryResult(result);
  return result;
}

async function recordTtiResult(rawDonationId, input, testedBy, repository = defaultLabRepository) {
  const donationId = parseDonationId(rawDonationId);
  const ttiInput = normaliseTtiInput(input);
  try {
    const result = await repository.recordTtiResult(donationId, { ...ttiInput, testedBy });
    throwForRepositoryResult(result);
    return result;
  } catch (error) {
    mapDuplicate(error);
  }
}

async function listNotifications(userId, repository = defaultLabRepository) {
  return repository.listNotifications(userId);
}

module.exports = {
  bloodGroupFromInput,
  normaliseTtiInput,
  recordBloodGroup,
  recordTtiResult,
  verifyBloodGroup,
  listNotifications,
};
