const db = require('../../db');

async function inTransaction(work) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function lockDonation(connection, donationId) {
  const [donationRows] = await connection.query(
    'SELECT id AS donation_id, donor_id FROM donations WHERE id = ? FOR UPDATE',
    [donationId]
  );
  if (!donationRows[0]) return null;

  const [units] = await connection.query(
    'SELECT id AS unit_id, unit_code, status FROM blood_units WHERE donation_id = ? FOR UPDATE',
    [donationId]
  );
  if (units.length === 0) return null;
  return { ...donationRows[0], units };
}

async function updateAvailability(connection, donationId) {
  await connection.query(
    `UPDATE blood_units
     SET status = 'AVAILABLE'
     WHERE donation_id = ? AND status = 'QUARANTINE'
       AND EXISTS (
         SELECT 1 FROM lab_results
         WHERE donation_id = ? AND test_type = 'ABO_RH'
           AND verification_status = 'VERIFIED'
       )
       AND (
         SELECT COUNT(*) FROM lab_results
         WHERE donation_id = ? AND test_type IN ('HIV', 'HBV', 'HCV', 'SYPHILIS', 'MALARIA')
           AND result = 'NON_REACTIVE'
       ) = 5`,
    [donationId, donationId, donationId]
  );
}

async function writeAudit(connection, userId, action, entityId, details) {
  await connection.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'blood_unit', ?, ?)`,
    [userId, action, String(entityId), JSON.stringify(details)]
  );
}

async function recordBloodGroup(donationId, bloodGroup, testedBy) {
  return inTransaction(async (connection) => {
    const donation = await lockDonation(connection, donationId);
    if (!donation) return { notFound: true };

    await connection.query(
      `INSERT INTO lab_results
       (donation_id, test_type, result, tested_by, verification_status)
       VALUES (?, 'ABO_RH', ?, ?, 'PENDING')`,
      [donationId, bloodGroup, testedBy]
    );
    for (const unit of donation.units) {
      await writeAudit(connection, testedBy, 'BLOOD_GROUP_RECORDED', unit.unit_code, { bloodGroup });
    }
    return { donationId, bloodGroup, verificationStatus: 'PENDING' };
  });
}

async function verifyBloodGroup(donationId, bloodGroup, verifiedBy) {
  return inTransaction(async (connection) => {
    const donation = await lockDonation(connection, donationId);
    if (!donation) return { notFound: true };

    const [rows] = await connection.query(
      `SELECT id, result, tested_by, verification_status
       FROM lab_results WHERE donation_id = ? AND test_type = 'ABO_RH' FOR UPDATE`,
      [donationId]
    );
    const result = rows[0];
    if (!result) return { resultNotFound: true };
    if (result.verification_status === 'VERIFIED') return { locked: true };
    if (Number(result.tested_by) === Number(verifiedBy)) return { sameUser: true };

    if (result.result !== bloodGroup) {
      await connection.query(
        `UPDATE lab_results
         SET verification_result = ?, verification_status = 'MISMATCH'
         WHERE id = ?`,
        [bloodGroup, result.id]
      );
      for (const unit of donation.units) {
        await writeAudit(connection, verifiedBy, 'BLOOD_GROUP_MISMATCH', unit.unit_code, {
          verificationStatus: 'MISMATCH',
        });
      }
      return { mismatch: true };
    }

    await connection.query(
      `UPDATE lab_results
       SET verified_by = ?, verified_at = NOW(), verification_result = ?,
           verification_status = 'VERIFIED'
       WHERE id = ?`,
      [verifiedBy, bloodGroup, result.id]
    );
    await connection.query('UPDATE blood_units SET blood_group = ? WHERE donation_id = ?', [
      bloodGroup,
      donationId,
    ]);
    await updateAvailability(connection, donationId);
    for (const unit of donation.units) {
      await writeAudit(connection, verifiedBy, 'BLOOD_GROUP_VERIFIED', unit.unit_code, { bloodGroup });
    }
    return { donationId, bloodGroup, verificationStatus: 'VERIFIED' };
  });
}

async function recordTtiResult(donationId, { testType, result, method, testedBy }) {
  return inTransaction(async (connection) => {
    const donation = await lockDonation(connection, donationId);
    if (!donation) return { notFound: true };

    await connection.query(
      `INSERT INTO lab_results (donation_id, test_type, result, method, tested_by)
       VALUES (?, ?, ?, ?, ?)`,
      [donationId, testType, result, method, testedBy]
    );

    if (result === 'REACTIVE') {
      await connection.query(
        `UPDATE blood_units
         SET status = 'DISCARDED', discard_reason = ?
         WHERE donation_id = ? AND status <> 'DISCARDED'`,
        [`Reactive TTI: ${testType}`, donationId]
      );
      await connection.query(
        `UPDATE donors
         SET eligibility_status = 'DEFERRED',
             deferral_reason = 'Reactive TTI requires confidential follow-up',
             follow_up_required = TRUE,
             follow_up_reason = 'Confidential follow-up required after reactive TTI'
         WHERE id = ?`,
        [donation.donor_id]
      );

      const [staff] = await connection.query(
        `SELECT id FROM users
         WHERE is_active = TRUE AND role IN ('LAB_TECH', 'MANAGER', 'ADMIN')`
      );
      for (const unit of donation.units) {
        for (const user of staff) {
          await connection.query(
            `INSERT INTO notifications
             (recipient_user_id, event_type, message, entity_type, entity_id)
             VALUES (?, 'REACTIVE_TTI', ?, 'blood_unit', ?)`,
            [
              user.id,
              `Confidential follow-up is required for blood unit ${unit.unit_code}.`,
              unit.unit_code,
            ]
          );
        }
        await writeAudit(connection, testedBy, 'REACTIVE_TTI_RECORDED', unit.unit_code, {
          testType,
          notificationsCreated: staff.length,
        });
      }

      return {
        donationId,
        unitCodes: donation.units.map((unit) => unit.unit_code),
        testType,
        result,
        status: 'DISCARDED',
      };
    }

    await updateAvailability(connection, donationId);
    for (const unit of donation.units) {
      await writeAudit(connection, testedBy, 'TTI_RESULT_RECORDED', unit.unit_code, {
        testType,
        result,
        method,
      });
    }
    return {
      donationId,
      unitCodes: donation.units.map((unit) => unit.unit_code),
      testType,
      result,
      method,
    };
  });
}

async function listNotifications(userId) {
  const [rows] = await db.query(
    `SELECT id, event_type, message, entity_type, entity_id, created_at, read_at
     FROM notifications
     WHERE recipient_user_id = ?
     ORDER BY created_at DESC, id DESC`,
    [userId]
  );
  return rows;
}


async function getQueueAndStorage() {
  const [donations] = await db.query(
    `SELECT 
       d.id AS donation_id,
       d.donor_id,
       d.collected_at,
       d.donation_type,
       d.volume_ml,
       d.status AS donation_status,
       dn.donor_code,
       dn.full_name AS donor_name,
       bu.id AS unit_id,
       bu.unit_code,
       bu.component,
       bu.blood_group,
       bu.status AS unit_status,
       bu.expires_at
     FROM donations d
     JOIN blood_units bu ON bu.donation_id = d.id
     JOIN donors dn ON dn.id = d.donor_id
     ORDER BY d.collected_at ASC, d.id ASC`
  );

  if (!donations || donations.length === 0) {
    return { queue: [], storage: [] };
  }

  const donationIds = donations.map((d) => d.donation_id);
  const [labRows] = await db.query(
    `SELECT id, donation_id, test_type, result, method, tested_by, verified_by, verification_status, tested_at
     FROM lab_results
     WHERE donation_id IN (?)
     ORDER BY id ASC`,
    [donationIds]
  );

  const resultsByDonation = {};
  for (const r of labRows) {
    if (!resultsByDonation[r.donation_id]) {
      resultsByDonation[r.donation_id] = [];
    }
    resultsByDonation[r.donation_id].push(r);
  }

  const allTtiTypes = ['HIV', 'HBV', 'HCV', 'SYPHILIS', 'MALARIA'];

  const items = donations.map((d) => {
    const results = resultsByDonation[d.donation_id] || [];
    const aboRow = results.find((r) => r.test_type === 'ABO_RH');
    const ttiRows = results.filter((r) => allTtiTypes.includes(r.test_type));

    const abo = aboRow
      ? {
          result: aboRow.result,
          verificationStatus: aboRow.verification_status,
          testedBy: aboRow.tested_by,
          verifiedBy: aboRow.verified_by,
        }
      : null;

    const ttiDone = ttiRows.map((r) => ({
      testType: r.test_type,
      result: r.result,
      method: r.method,
    }));

    const completedTtiTypes = ttiDone.map((r) => r.testType);
    const ttiRemaining = allTtiTypes.filter((t) => !completedTtiTypes.includes(t));
    const hasReactive = ttiDone.some((r) => r.result === 'REACTIVE');
    const isAboVerified = Boolean(abo && abo.verificationStatus === 'VERIFIED');
    const isFullyTested = isAboVerified && ttiDone.length === 5 && !hasReactive;

    return {
      donationId: d.donation_id,
      donorId: d.donor_id,
      donorCode: d.donor_code,
      donorName: d.donor_name,
      collectedAt: d.collected_at,
      donationType: d.donation_type,
      volumeMl: d.volume_ml,
      donationStatus: d.donation_status,
      unitId: d.unit_id,
      unitCode: d.unit_code,
      component: d.component,
      bloodGroup: d.blood_group,
      unitStatus: d.unit_status,
      expiresAt: d.expires_at,
      abo,
      tti: {
        results: ttiDone,
        completedCount: ttiDone.length,
        remaining: ttiRemaining,
        hasReactive,
      },
      isFullyTested,
      needsAbo: !abo || abo.verificationStatus !== 'VERIFIED',
      needsVerification: Boolean(abo && abo.verificationStatus === 'PENDING'),
      needsTti: ttiDone.length < 5,
    };
  });

  // Testing queue is strictly First In First Out (oldest collected blood tested first)
  const queue = items
    .filter((item) => item.unitStatus === 'QUARANTINE' || !item.isFullyTested)
    .sort((a, b) => new Date(a.collectedAt).getTime() - new Date(b.collectedAt).getTime() || a.donationId - b.donationId);
  const storage = items;

  return { queue, storage };
}

module.exports = {
  getQueueAndStorage,
  listNotifications,
  recordBloodGroup,
  recordTtiResult,
  verifyBloodGroup,
};
