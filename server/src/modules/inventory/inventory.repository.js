const db = require('../../db');

async function listAvailable({ bloodGroup = null, component = null } = {}) {
  const conditions = [
    "bu.status = 'AVAILABLE'",
    'bu.expires_at > NOW()',
    `EXISTS (
      SELECT 1 FROM lab_results abo
      WHERE abo.donation_id = bu.donation_id
        AND abo.test_type = 'ABO_RH'
        AND abo.verification_status = 'VERIFIED'
    )`,
    `(
      SELECT COUNT(*) FROM lab_results tti
      WHERE tti.donation_id = bu.donation_id
        AND tti.test_type IN ('HIV', 'HBV', 'HCV', 'SYPHILIS', 'MALARIA')
        AND tti.result = 'NON_REACTIVE'
    ) = 5`,
  ];
  const values = [];
  if (bloodGroup) {
    conditions.push('bu.blood_group = ?');
    values.push(bloodGroup);
  }
  if (component) {
    conditions.push('bu.component = ?');
    values.push(component);
  }

  const [rows] = await db.query(
    `SELECT bu.id, bu.unit_code, bu.component, bu.blood_group, bu.volume_ml,
            bu.collected_at, bu.expires_at, bu.status
     FROM blood_units bu
     WHERE ${conditions.join(' AND ')}
     ORDER BY bu.expires_at ASC, bu.id ASC`,
    values
  );
  return rows;
}

module.exports = { listAvailable };
