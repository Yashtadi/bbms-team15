const db = require('../../db');

// BBMS-F-022: the single definition of "releasable stock". Both the unit list and the
// F-030 dashboard summary use it, so the dashboard can never count a unit the list hides.
function releasableStockFilter({ bloodGroup = null, component = null } = {}) {
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
  return { where: conditions.join(' AND '), values };
}

async function listAvailable({ bloodGroup = null, component = null } = {}) {
  const { where, values } = releasableStockFilter({ bloodGroup, component });
  const [rows] = await db.query(
    `SELECT bu.id, bu.unit_code, bu.component, bu.blood_group, bu.volume_ml,
            bu.collected_at, bu.expires_at, bu.status
     FROM blood_units bu
     WHERE ${where}
     ORDER BY bu.expires_at ASC, bu.id ASC`,
    values
  );
  return rows;
}

// BBMS-F-030: releasable stock counted per blood group and component.
// The database does the counting (GROUP BY) so the dashboard stays fast (NF-001).
async function summarizeAvailable() {
  const { where, values } = releasableStockFilter();
  const [rows] = await db.query(
    `SELECT bu.blood_group, bu.component,
            COUNT(*) AS units,
            SUM(bu.volume_ml) AS volume_ml,
            MIN(bu.expires_at) AS next_expiry
     FROM blood_units bu
     WHERE ${where}
     GROUP BY bu.blood_group, bu.component
     ORDER BY bu.blood_group, bu.component`,
    values
  );
  return rows;
}

module.exports = { listAvailable, summarizeAvailable };
