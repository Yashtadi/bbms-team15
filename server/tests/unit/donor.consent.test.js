const { recordConsent } = require('../../src/modules/donor/donor.service');
const { startDonation } = require('../../src/modules/collection/collection.service');

describe('TC-Reg-04: digital donor consent (unit)', () => {
  describe('recordConsent service logic', () => {
    it('captures digital consent, links to donor, and stores timestamp (AC 2)', async () => {
      const mockRepo = {
        findByIdOrCode: jest.fn().mockResolvedValue({
          id: 5,
          donor_code: 'D-000005',
          full_name: 'Sameer Khan',
          consent_given: 0,
          consent_at: null,
        }),
        updateConsent: jest.fn().mockResolvedValue(true),
      };

      const result = await recordConsent('D-000005', true, mockRepo);

      expect(mockRepo.findByIdOrCode).toHaveBeenCalledWith('D-000005');
      expect(mockRepo.updateConsent).toHaveBeenCalledWith(
        5,
        true,
        expect.any(Date)
      );

      expect(result).toMatchObject({
        donorId: 'D-000005',
        consentGiven: true,
        consentAt: expect.any(Date),
      });
    });

    it('rejects explicit non-consent (consent: false) with 400 Bad Request', async () => {
      const mockRepo = {
        findByIdOrCode: jest.fn().mockResolvedValue({ id: 1, donor_code: 'D-000001' }),
        updateConsent: jest.fn(),
      };

      await expect(recordConsent(1, false, mockRepo)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('Consent must be explicitly granted'),
      });
      expect(mockRepo.updateConsent).not.toHaveBeenCalled();
    });

    it('throws 404 if donor does not exist', async () => {
      const mockRepo = {
        findByIdOrCode: jest.fn().mockResolvedValue(null),
        updateConsent: jest.fn(),
      };

      await expect(recordConsent(999, true, mockRepo)).rejects.toMatchObject({
        status: 404,
        message: 'Donor not found',
      });
    });
  });

  describe('startDonation consent enforcement (AC 1 & AC 3)', () => {
    it('rejects a donation without consent with 422 Unprocessable Entity (AC 3)', async () => {
      const mockDonorRepo = {
        findByIdOrCode: jest.fn().mockResolvedValue({
          id: 5,
          donor_code: 'D-000005',
          consent_given: 0, // no consent
        }),
      };
      const mockCollectionRepo = {
        createSession: jest.fn(),
      };

      await expect(
        startDonation({ donorId: 'D-000005', staffId: 3, volumeMl: 450 }, mockDonorRepo, mockCollectionRepo)
      ).rejects.toMatchObject({
        status: 422,
        code: 'CONSENT_REQUIRED',
        message: 'Consent must be captured before a donation can proceed',
      });

      expect(mockCollectionRepo.createSession).not.toHaveBeenCalled();
    });

    it('allows donation when consent is present, returning 201 payload (AC 1)', async () => {
      const mockDonorRepo = {
        findByIdOrCode: jest.fn().mockResolvedValue({
          id: 1,
          donor_code: 'D-000001',
          consent_given: 1, // consent granted
          eligibility_status: 'ELIGIBLE', // F-010: sessions also need an eligible donor
        }),
      };
      const mockCollectionRepo = {
        createSession: jest.fn().mockResolvedValue({
          donationId: 42,
          unit: { id: 9, unitCode: 'U-2026-000009' },
        }),
      };

      const result = await startDonation(
        { donorId: 'D-000001', staffId: 3, volumeMl: 450 },
        mockDonorRepo,
        mockCollectionRepo
      );

      expect(mockCollectionRepo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          donorId: 1,
          volumeMl: 450,
        })
      );
      expect(result).toMatchObject({
        donationId: 42,
        donorId: 'D-000001',
        status: 'IN_PROGRESS',
      });
    });

    it('throws 400 if donorId is missing from input', async () => {
      await expect(startDonation({})).rejects.toMatchObject({
        status: 400,
        message: 'donorId is required to start a donation',
      });
    });

    it('throws 404 if donor is not found', async () => {
      const mockDonorRepo = {
        findByIdOrCode: jest.fn().mockResolvedValue(null),
      };

      await expect(startDonation({ donorId: 999, staffId: 3, volumeMl: 450 }, mockDonorRepo)).rejects.toMatchObject({
        status: 404,
        message: 'Donor not found',
      });
    });
  });
});
