const defaultDonorRepository = require('../donor/donor.repository');
const defaultCollectionRepository = require('./collection.repository');

/**
 * BBMS-F-004 & BBMS-F-010: Starts a donation session.
 * 
 * Acceptance Criteria (BBMS-F-004):
 * 1. Consent must be captured before a donation can proceed.
 * 2. Attempting a donation without consent is rejected with 422.
 * 
 * @param {object} input
 * @param {object} donorRepo
 * @param {object} collectionRepo
 * @returns {Promise<{ donationId: number, donorId: string, status: string }>}
 */
async function startDonation(
  input,
  donorRepo = defaultDonorRepository,
  collectionRepo = defaultCollectionRepository
) {
  const donorIdentifier = input.donorId || input.donor_id;
  if (!donorIdentifier) {
    const error = new Error('donorId is required to start a donation');
    error.status = 400;
    throw error;
  }

  // 1. Find donor
  const donor = await donorRepo.findByIdOrCode(donorIdentifier);
  if (!donor) {
    const error = new Error('Donor not found');
    error.status = 404;
    throw error;
  }

  // 2. AC 1 & 3: Attempting a donation without consent is rejected with 422
  if (!donor.consent_given) {
    const error = new Error('Consent must be captured before a donation can proceed');
    error.status = 422;
    error.code = 'CONSENT_REQUIRED';
    throw error;
  }

  // 3. Create donation session
  const donation = await collectionRepo.createDonation({
    donorId: donor.id,
    collectedBy: input.collectedBy || null,
    campLocation: input.campLocation || null,
    status: 'IN_PROGRESS',
    volumeMl: input.volumeMl || null,
    weightKg: input.weightKg || input.weight || null,
    hemoglobinGDl: input.hemoglobinGDl || input.hemoglobin || null,
  });

  return {
    donationId: donation.id,
    donorId: donor.donor_code,
    status: 'IN_PROGRESS',
  };
}

module.exports = {
  startDonation,
};
