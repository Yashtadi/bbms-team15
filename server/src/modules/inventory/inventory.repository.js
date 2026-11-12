const crypto = require('crypto');
const db = require('../../db');

// BBMS-F-042: a RESERVED unit whose hold has run out counts as AVAILABLE again straight away,
// even before the expiry sweep has reset the row.
const EXPIRED_RESERVATION_SQL =
  "(bu.status = 'RESERVED' AND bu.reserved_until IS NOT NULL AND bu.reserved_until <= NOW())";

// BBMS-F-022: the single definition of "releasable stock". Both the unit list and the
// F-030 dashboard summary use it, so the dashboard can never count a unit the list hides.
// F-042: units on an active reservation are excluded, so they can't be allocated twice.
function releasableStockFilter({ bloodGroup = null, component = null } = {}) {
  const conditions = [
    `(bu.status = 'AVAILABLE' OR ${EXPIRED_RESERVATION_SQL})`,
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
            bu.collected_at, bu.expires_at,
            IF(bu.status = 'RESERVED', 'AVAILABLE', bu.status) AS status
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

// BBMS-F-031: columns returned for a unit in separation and lineage results
const UNIT_COLUMNS = `bu.id, bu.unit_code, bu.donation_id, bu.parent_unit_id, bu.component,
  bu.blood_group, bu.volume_ml, bu.collected_at, bu.expires_at, bu.status, bu.discard_reason`;

// A unit plus its parent's unit code (NULL unless it is a component)
const UNIT_WITH_PARENT_SQL = `SELECT ${UNIT_COLUMNS}, p.unit_code AS parent_unit_code
  FROM blood_units bu
  LEFT JOIN blood_units p ON p.id = bu.parent_unit_id`;

/**
 * BBMS-F-031: Finds a unit by its unit code, with its parent's code if it is a component.
 * @param {string} unitCode
 * @returns {Promise<object|null>}
 */
async function findUnitByCode(unitCode) {
  const [rows] = await db.query(`${UNIT_WITH_PARENT_SQL} WHERE bu.unit_code = ?`, [unitCode]);
  return rows[0] || null;
}

async function findUnitById(id) {
  const [rows] = await db.query(`${UNIT_WITH_PARENT_SQL} WHERE bu.id = ?`, [id]);
  return rows[0] || null;
}

async function findChildren(parentId) {
  const [rows] = await db.query(
    `${UNIT_WITH_PARENT_SQL} WHERE bu.parent_unit_id = ? ORDER BY bu.id ASC`,
    [parentId]
  );
  return rows;
}

async function findDonationSummary(donationId) {
  const [rows] = await db.query(
    `SELECT d.id AS donation_id, d.donation_type, d.collected_at, d.camp_location, dn.donor_code
     FROM donations d JOIN donors dn ON dn.id = d.donor_id
     WHERE d.id = ?`,
    [donationId]
  );
  return rows[0] || null;
}

/**
 * BBMS-F-031: A unit with its family: the parent it came from, the components made from it,
 * its sibling components and the donation they all trace back to.
 * @param {string} unitCode
 * @returns {Promise<{ unit, parent, children, siblings, donation }|null>}
 */
async function findLineage(unitCode) {
  const unit = await findUnitByCode(unitCode);
  if (!unit) return null;

  const parent = unit.parent_unit_id ? await findUnitById(unit.parent_unit_id) : null;
  const children = await findChildren(unit.id);
  const siblings = parent
    ? (await findChildren(parent.id)).filter((sibling) => sibling.id !== unit.id)
    : [];
  const donation = await findDonationSummary(unit.donation_id);

  return { unit, parent, children, siblings, donation };
}

/**
 * BBMS-F-031: Separates a unit into components in one transaction.
 *
 * The parent row is locked (FOR UPDATE) first, so two separations of the same bag can never
 * both succeed. planChildren(parent) applies the business rules to the locked row: it throws
 * (with error.status) to refuse, or returns the components to create. Each child copies the
 * parent's donation, blood group, status and collection time. The parent becomes SEPARATED.
 *
 * @param {string} unitCode
 * @param {function(object): Array<{ component: string, volumeMl: number, expiresAt: Date }>} planChildren
 * @param {{ userId: number, buildUnitCode: function(object, number): string }} options
 * @returns {Promise<{ notFound: true }|{ parent: object, children: object[] }>}
 */
async function separateUnit(unitCode, planChildren, { userId, buildUnitCode }) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT ${UNIT_COLUMNS} FROM blood_units bu WHERE bu.unit_code = ? FOR UPDATE`,
      [unitCode]
    );
    const parent = rows[0];
    if (!parent) {
      await connection.rollback();
      return { notFound: true };
    }

    const plan = planChildren(parent);

    const children = [];
    for (const child of plan) {
      const placeholderCode = `TMP-${crypto.randomBytes(12).toString('hex')}`;
      const [result] = await connection.query(
        `INSERT INTO blood_units (
          unit_code, donation_id, parent_unit_id, component, blood_group, volume_ml,
          collected_at, expires_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          placeholderCode, parent.donation_id, parent.id, child.component, parent.blood_group,
          child.volumeMl, parent.collected_at, child.expiresAt, parent.status,
        ]
      );
      const id = result.insertId;
      const code = buildUnitCode(parent, id);
      await connection.query('UPDATE blood_units SET unit_code = ? WHERE id = ?', [code, id]);
      children.push({
        id,
        unit_code: code,
        donation_id: parent.donation_id,
        parent_unit_id: parent.id,
        parent_unit_code: parent.unit_code,
        component: child.component,
        blood_group: parent.blood_group,
        volume_ml: child.volumeMl,
        collected_at: parent.collected_at,
        expires_at: child.expiresAt,
        status: parent.status,
      });
    }

    await connection.query("UPDATE blood_units SET status = 'SEPARATED' WHERE id = ?", [parent.id]);

    await connection.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES (?, 'UNIT_SEPARATED', 'blood_unit', ?, ?)`,
      [userId, parent.unit_code, JSON.stringify({ components: children.map((c) => c.unit_code) })]
    );
    for (const child of children) {
      await connection.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
         VALUES (?, 'COMPONENT_CREATED', 'blood_unit', ?, ?)`,
        [userId, child.unit_code, JSON.stringify({ parentUnitCode: parent.unit_code, component: child.component })]
      );
    }

    await connection.commit();
    return { parent: { ...parent, status: 'SEPARATED' }, children };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * BBMS-F-032: Finds units nearing expiry within a given threshold (default 3 days).
 * Only unexpired units in physical bank inventory (AVAILABLE, QUARANTINE, RESERVED) are included.
 * @param {object} options
 * @param {number} [options.thresholdDays=3]
 * @param {string[]} [options.statuses=['AVAILABLE', 'QUARANTINE', 'RESERVED']]
 * @param {Date} [options.now=new Date()]
 * @returns {Promise<Array<object>>}
 */
async function findExpiringUnits({
  thresholdDays = 3,
  statuses = ['AVAILABLE', 'QUARANTINE', 'RESERVED'],
  now = new Date(),
} = {}) {
  const targetDate = new Date(now.getTime() + thresholdDays * 24 * 60 * 60 * 1000);
  const [rows] = await db.query(
    `SELECT bu.id, bu.unit_code, bu.donation_id, bu.component, bu.blood_group,
            bu.volume_ml, bu.collected_at, bu.expires_at, bu.status, bu.discard_reason
     FROM blood_units bu
     WHERE bu.status IN (?)
       AND bu.expires_at > ?
       AND bu.expires_at <= ?
     ORDER BY bu.expires_at ASC, bu.id ASC`,
    [statuses, now, targetDate]
  );
  return rows;
}

/**
 * BBMS-F-033: Finds all releasable units available for allocation, ordered strictly FEFO (soonest-to-expire first).
 * Uses releasableStockFilter to ensure only verified, safe, available units are selected.
 * @param {object} options
 * @param {string} [options.component]
 * @returns {Promise<Array<object>>}
 */
async function findAvailableForAllocation({ component = null } = {}) {
  const { where, values } = releasableStockFilter({ component });
  const [rows] = await db.query(
    `SELECT bu.id, bu.unit_code, bu.donation_id, bu.component, bu.blood_group,
            bu.volume_ml, bu.collected_at, bu.expires_at,
            IF(bu.status = 'RESERVED', 'AVAILABLE', bu.status) AS status
     FROM blood_units bu
     WHERE ${where}
     ORDER BY bu.expires_at ASC, bu.id ASC`,
    values
  );
  return rows;
}

/**
 * BBMS-F-034: Aggregates total releasable stock units per blood group.
 * @returns {Promise<Array<{ blood_group: string, units: number, volume_ml: number }>>}
 */
async function summarizeStockByBloodGroup() {
  const { where, values } = releasableStockFilter();
  const [rows] = await db.query(
    `SELECT bu.blood_group,
            COUNT(*) AS units,
            SUM(bu.volume_ml) AS volume_ml
     FROM blood_units bu
     WHERE ${where}
     GROUP BY bu.blood_group
     ORDER BY bu.blood_group`,
    values
  );
  return rows;
}

module.exports = {
  releasableStockFilter,
  listAvailable,
  summarizeAvailable,
  findUnitByCode,
  findLineage,
  separateUnit,
  findExpiringUnits,
  findAvailableForAllocation,
  summarizeStockByBloodGroup,
};
