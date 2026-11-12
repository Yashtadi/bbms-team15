const db = require('../../db');
const { releasableStockFilter } = require('../inventory/inventory.repository');

// BBMS-F-042: a hold is active while it is RESERVED and its window has not run out.
// A NULL reserved_until (no window recorded) never expires on its own.
const RESERVATION_ACTIVE_SQL =
  "(status = 'RESERVED' AND (reserved_until IS NULL OR reserved_until > NOW()))";

const REQUEST_CODE_REGEX = /^R-\d{6,}$/;

/**
 * BBMS-F-040: Formats a sequential request code (e.g. R-000001).
 * @param {number} seqNumber
 * @returns {string}
 */
function formatRequestCode(seqNumber) {
  return `R-${String(seqNumber).padStart(6, '0')}`;
}

/**
 * Parses numeric sequence from a request code string.
 * @param {string} code
 * @returns {number|null}
 */
function parseRequestCode(code) {
  if (typeof code !== 'string') return null;
  const match = /^R-(\d+)$/i.exec(code.trim());
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Checks whether a string matches standard request code format.
 * @param {string} code
 * @returns {boolean}
 */
function isValidRequestCode(code) {
  return typeof code === 'string' && REQUEST_CODE_REGEX.test(code.trim());
}

/**
 * Generates the next sequential Request Code (e.g. R-000003).
 * Checks both blood_requests table and audit_log to guarantee uniqueness.
 * @param {object} [connection]
 * @returns {Promise<string>}
 */
async function generateNextRequestCode(connection = null) {
  const runner = connection || db;
  let nextSeq = 1;

  try {
    const [rows] = await runner.query('SELECT MAX(id) AS maxId FROM blood_requests');
    if (rows[0]?.maxId) {
      nextSeq = Number(rows[0].maxId) + 1;
    }
  } catch {
    // Non-fatal fallback
  }

  try {
    const [auditRows] = await runner.query(
      `SELECT entity_id FROM audit_log WHERE entity_type = 'blood_request' AND action = 'REQUEST_SUBMITTED'`
    );
    for (const row of auditRows) {
      const num = parseRequestCode(row.entity_id);
      if (num && num >= nextSeq) {
        nextSeq = num + 1;
      }
    }
  } catch {
    // Non-fatal fallback
  }

  return formatRequestCode(nextSeq);
}

/**
 * Maps database row to standardized request model.
 * @param {object} row
 * @returns {object}
 */
function mapRowToRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.requestCode,
    requestCode: row.requestCode,
    hospitalUserId: row.hospitalUserId,
    patientName: row.patientName,
    patientBloodGroup: row.patientBloodGroup,
    component: row.component,
    unitsRequested: row.unitsRequested,
    priority: row.priority,
    status: row.status,
    requiredBy: row.requiredBy ? new Date(row.requiredBy).toISOString() : null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    hospital: {
      id: row.hospitalUserId,
      fullName: row.hospitalUserName || null,
      organisation: row.hospitalOrganisation || null,
      email: row.hospitalEmail || null,
    },
  };
}

/**
 * Atomically creates a new blood request with status 'PENDING' and records audit trail.
 * @param {object} data
 * @param {object} [connection]
 * @returns {Promise<object>}
 */
async function createRequest(data, connection = null) {
  const shouldManageTx = !connection;
  const conn = connection || (await db.getConnection());

  try {
    if (shouldManageTx) await conn.beginTransaction();

    let requestCode = data.requestCode;
    if (!requestCode) {
      requestCode = await generateNextRequestCode(conn);
    }

    const [result] = await conn.query(
      `INSERT INTO blood_requests (
        request_code, hospital_user_id, patient_name, patient_blood_group,
        component, units_requested, priority, status, required_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requestCode,
        data.hospitalUserId,
        data.patientName,
        data.patientBloodGroup,
        data.component,
        data.unitsRequested,
        data.priority || 'ROUTINE',
        data.status || 'PENDING',
        data.requiredBy ? new Date(data.requiredBy) : null,
      ]
    );

    const insertId = result.insertId;

    // Record immutable audit log
    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES (?, 'REQUEST_SUBMITTED', 'blood_request', ?, ?)`,
      [
        data.hospitalUserId,
        requestCode,
        JSON.stringify({
          id: insertId,
          requestCode,
          patientName: data.patientName,
          patientBloodGroup: data.patientBloodGroup,
          component: data.component,
          unitsRequested: data.unitsRequested,
          priority: data.priority || 'ROUTINE',
          requiredBy: data.requiredBy || null,
        }),
      ]
    );

    if (shouldManageTx) await conn.commit();

    // Fetch complete joined object with user/organisation info
    const created = await findByIdOrCode(insertId, conn);
    return created;
  } catch (error) {
    if (shouldManageTx) await conn.rollback();
    throw error;
  } finally {
    if (shouldManageTx) conn.release();
  }
}

/**
 * Finds a blood request by its numeric ID or request code (e.g. 'R-000001').
 * @param {number|string} idOrCode
 * @param {object} [connection]
 * @returns {Promise<object|null>}
 */
async function findByIdOrCode(idOrCode, connection = null) {
  const runner = connection || db;
  const isNumeric = /^\d+$/.test(String(idOrCode).trim());
  const query = `
    SELECT 
      br.id,
      br.request_code AS requestCode,
      br.hospital_user_id AS hospitalUserId,
      br.patient_name AS patientName,
      br.patient_blood_group AS patientBloodGroup,
      br.component,
      br.units_requested AS unitsRequested,
      br.priority,
      br.status,
      br.required_by AS requiredBy,
      br.created_at AS createdAt,
      u.full_name AS hospitalUserName,
      u.organisation AS hospitalOrganisation,
      u.email AS hospitalEmail
    FROM blood_requests br
    JOIN users u ON br.hospital_user_id = u.id
    WHERE ${isNumeric ? 'br.id = ?' : 'br.request_code = ?'}
  `;
  const [rows] = await runner.query(query, [isNumeric ? Number(idOrCode) : String(idOrCode).trim().toUpperCase()]);
  return rows[0] ? mapRowToRequest(rows[0]) : null;
}

/**
 * Lists blood requests with optional hospital, status, and priority filters.
 * Sorted by priority (EMERGENCY -> URGENT -> ROUTINE) and created_at DESC.
 * @param {object} filters
 * @param {number} [filters.hospitalUserId]
 * @param {string} [filters.status]
 * @param {string} [filters.priority]
 * @param {object} [connection]
 * @returns {Promise<Array<object>>}
 */
async function listRequests({ hospitalUserId = null, status = null, priority = null } = {}, connection = null) {
  const runner = connection || db;
  const whereClauses = [];
  const params = [];

  if (hospitalUserId) {
    whereClauses.push('br.hospital_user_id = ?');
    params.push(hospitalUserId);
  }
  if (status) {
    whereClauses.push('br.status = ?');
    params.push(status);
  }
  if (priority) {
    whereClauses.push('br.priority = ?');
    params.push(priority);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const query = `
    SELECT 
      br.id,
      br.request_code AS requestCode,
      br.hospital_user_id AS hospitalUserId,
      br.patient_name AS patientName,
      br.patient_blood_group AS patientBloodGroup,
      br.component,
      br.units_requested AS unitsRequested,
      br.priority,
      br.status,
      br.required_by AS requiredBy,
      br.created_at AS createdAt,
      u.full_name AS hospitalUserName,
      u.organisation AS hospitalOrganisation,
      u.email AS hospitalEmail
    FROM blood_requests br
    JOIN users u ON br.hospital_user_id = u.id
    ${whereSql}
    ORDER BY 
      CASE br.priority 
        WHEN 'EMERGENCY' THEN 1 
        WHEN 'URGENT' THEN 2 
        WHEN 'ROUTINE' THEN 3 
        ELSE 4 
      END ASC,
      br.created_at DESC
  `;

  const [rows] = await runner.query(query, params);
  return rows.map(mapRowToRequest);
}


/**
 * BBMS-F-041: Finds a blood unit by unitCode.
 * @param {string} unitCode
 * @param {object} [connection]
 * @returns {Promise<object|null>}
 */
async function findUnitByCode(unitCode, connection = null) {
  const runner = connection || db;
  const [rows] = await runner.query(
    `SELECT id, unit_code, donation_id, parent_unit_id, component, blood_group,
            volume_ml, collected_at, expires_at, status, discard_reason, reserved_for_request_id,
            reserved_until, ${RESERVATION_ACTIVE_SQL} AS reservation_active
     FROM blood_units
     WHERE unit_code = ?`,
    [String(unitCode).trim().toUpperCase()]
  );
  return rows[0] || null;
}

/**
 * BBMS-F-041: Inserts a crossmatch record and logs audit trail.
 * @param {object} params
 * @param {number} params.requestId
 * @param {number} params.unitId
 * @param {'COMPATIBLE'|'INCOMPATIBLE'} params.result
 * @param {number} params.performedBy
 * @param {object} [connection]
 * @returns {Promise<object>}
 */
async function createCrossmatch({ requestId, unitId, result, performedBy }, connection = null) {
  const shouldManageTx = !connection;
  const conn = connection || (await db.getConnection());

  try {
    if (shouldManageTx) await conn.beginTransaction();

    const [insertResult] = await conn.query(
      `INSERT INTO crossmatches (request_id, unit_id, result, performed_by)
       VALUES (?, ?, ?, ?)`,
      [requestId, unitId, result, performedBy]
    );

    const crossmatchId = insertResult.insertId;

    // Immutable audit log
    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES (?, 'CROSSMATCH_RECORDED', 'crossmatch', ?, ?)`,
      [
        performedBy,
        String(crossmatchId),
        JSON.stringify({
          crossmatchId,
          requestId,
          unitId,
          result,
        }),
      ]
    );

    if (shouldManageTx) await conn.commit();

    return {
      id: crossmatchId,
      requestId,
      unitId,
      result,
      performedBy,
      performedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (shouldManageTx) await conn.rollback();
    throw error;
  } finally {
    if (shouldManageTx) conn.release();
  }
}

/**
 * Finds the latest crossmatch for a given (requestId, unitId) pair.
 * @param {number} requestId
 * @param {number} unitId
 * @param {object} [connection]
 * @returns {Promise<object|null>}
 */
async function findLatestCrossmatch(requestId, unitId, connection = null) {
  const runner = connection || db;
  const [rows] = await runner.query(
    `SELECT cm.id, cm.request_id AS requestId, cm.unit_id AS unitId, cm.result, cm.performed_at AS performedAt,
            u.id AS performedById, u.full_name AS performedByName
     FROM crossmatches cm
     JOIN users u ON cm.performed_by = u.id
     WHERE cm.request_id = ? AND cm.unit_id = ?
     ORDER BY cm.performed_at DESC, cm.id DESC
     LIMIT 1`,
    [requestId, unitId]
  );
  return rows[0] || null;
}

/**
 * Lists all crossmatch tests performed for a request.
 * @param {number} requestId
 * @param {object} [connection]
 * @returns {Promise<Array<object>>}
 */
async function listCrossmatchesForRequest(requestId, connection = null) {
  const runner = connection || db;
  const [rows] = await runner.query(
    `SELECT cm.id, cm.request_id AS requestId, cm.unit_id AS unitId,
            bu.unit_code AS unitCode, bu.blood_group AS unitBloodGroup, bu.component,
            bu.status AS unitStatus, bu.expires_at AS unitExpiresAt,
            cm.result, cm.performed_at AS performedAt,
            u.id AS performedById, u.full_name AS performedByName
     FROM crossmatches cm
     JOIN blood_units bu ON cm.unit_id = bu.id
     JOIN users u ON cm.performed_by = u.id
     WHERE cm.request_id = ?
     ORDER BY cm.performed_at DESC, cm.id DESC`,
    [requestId]
  );

  return rows.map((row) => ({
    id: row.id,
    requestId: row.requestId,
    unitId: row.unitId,
    unitCode: row.unitCode,
    unitBloodGroup: row.unitBloodGroup,
    component: row.component,
    unitStatus: row.unitStatus,
    result: row.result,
    readyForIssuance: row.result === 'COMPATIBLE',
    performedAt: row.performedAt ? new Date(row.performedAt).toISOString() : new Date().toISOString(),
    performedBy: {
      id: row.performedById,
      fullName: row.performedByName,
    },
  }));
}

// BBMS-F-042: columns read for a unit while placing or releasing a hold
const RESERVATION_UNIT_COLUMNS = `id, unit_code, component, blood_group, volume_ml, expires_at, status,
  reserved_for_request_id, reserved_until, ${RESERVATION_ACTIVE_SQL} AS reservation_active`;

async function lockRequest(conn, requestId) {
  const [rows] = await conn.query(
    `SELECT id, request_code, patient_blood_group, component, units_requested, status
     FROM blood_requests WHERE id = ? FOR UPDATE`,
    [requestId]
  );
  return rows[0] || null;
}

async function lockUnit(conn, unitCode) {
  const [rows] = await conn.query(
    `SELECT ${RESERVATION_UNIT_COLUMNS} FROM blood_units WHERE unit_code = ? FOR UPDATE`,
    [String(unitCode).trim().toUpperCase()]
  );
  return rows[0] || null;
}

async function countActiveReservations(requestId, connection = null) {
  const runner = connection || db;
  const [rows] = await runner.query(
    `SELECT COUNT(*) AS active FROM blood_units
     WHERE reserved_for_request_id = ? AND ${RESERVATION_ACTIVE_SQL}`,
    [requestId]
  );
  return Number(rows[0]?.active || 0);
}

/**
 * BBMS-F-042: A request is RESERVED while all of its units are held, PENDING otherwise.
 * Only PENDING and RESERVED requests are touched, so ISSUED/REJECTED/CANCELLED never change here.
 */
async function syncRequestStatus(conn, requestId) {
  await conn.query(
    `UPDATE blood_requests br
     SET br.status = IF(
       (SELECT COUNT(*) FROM blood_units
        WHERE reserved_for_request_id = br.id AND ${RESERVATION_ACTIVE_SQL}) >= br.units_requested,
       'RESERVED', 'PENDING')
     WHERE br.id = ? AND br.status IN ('PENDING', 'RESERVED')`,
    [requestId]
  );
  const [rows] = await conn.query('SELECT status FROM blood_requests WHERE id = ?', [requestId]);
  return rows[0]?.status || null;
}

/**
 * BBMS-F-042: Reserves a unit for a request in one transaction.
 *
 * The request row and then the unit row are locked (FOR UPDATE), so two staff members can never
 * hold the same bag, and a request can never get more holds than units requested.
 * planReservation(context) applies the business rules to the locked rows: it throws (with
 * error.status) to refuse. The hold window is counted by the database clock (NOW()).
 *
 * @param {{ requestId: number, unitCode: string, holdMinutes: number, userId: number }} params
 * @param {function(object): void} planReservation
 * @returns {Promise<{ requestNotFound: true }|{ unitNotFound: true }|object>}
 */
async function reserveUnit({ requestId, unitCode, holdMinutes, userId }, planReservation) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const request = await lockRequest(conn, requestId);
    if (!request) {
      await conn.rollback();
      return { requestNotFound: true };
    }
    const unit = await lockUnit(conn, unitCode);
    if (!unit) {
      await conn.rollback();
      return { unitNotFound: true };
    }

    const { where, values } = releasableStockFilter();
    const [releasableRows] = await conn.query(
      `SELECT bu.id FROM blood_units bu WHERE bu.id = ? AND ${where}`,
      [unit.id, ...values]
    );
    const crossmatch = await findLatestCrossmatch(request.id, unit.id, conn);
    const activeCount = await countActiveReservations(request.id, conn);

    planReservation({
      request,
      unit: { ...unit, reservation_active: Boolean(Number(unit.reservation_active)) },
      isReleasable: releasableRows.length > 0,
      crossmatch,
      activeCount,
    });

    await conn.query(
      `UPDATE blood_units
       SET status = 'RESERVED', reserved_for_request_id = ?, reserved_by = ?,
           reserved_until = NOW() + INTERVAL ? MINUTE
       WHERE id = ?`,
      [request.id, userId, holdMinutes, unit.id]
    );

    // A unit taken over from another request's lapsed hold may change that request's status too
    if (unit.reserved_for_request_id && unit.reserved_for_request_id !== request.id) {
      await syncRequestStatus(conn, unit.reserved_for_request_id);
    }
    const requestStatus = await syncRequestStatus(conn, request.id);

    const [[saved]] = await conn.query(
      `SELECT reserved_until, TIMESTAMPDIFF(SECOND, NOW(), reserved_until) AS seconds_remaining
       FROM blood_units WHERE id = ?`,
      [unit.id]
    );

    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES (?, 'UNIT_RESERVED', 'blood_unit', ?, ?)`,
      [
        userId,
        unit.unit_code,
        JSON.stringify({
          requestCode: request.request_code,
          holdMinutes,
          reservedUntil: saved.reserved_until,
          crossmatchId: crossmatch ? crossmatch.id : null,
        }),
      ]
    );

    await conn.commit();

    return {
      request: { ...request, status: requestStatus },
      unit,
      crossmatchId: crossmatch ? crossmatch.id : null,
      reservedUntil: saved.reserved_until,
      secondsRemaining: Number(saved.seconds_remaining),
      activeReservations: activeCount + 1,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * BBMS-F-042: Releases a unit held for a request and puts it back in stock (AVAILABLE).
 * @returns {Promise<{ requestNotFound: true }|{ unitNotFound: true }|{ notReserved: true }|object>}
 */
async function releaseReservation({ requestId, unitCode, userId }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const request = await lockRequest(conn, requestId);
    if (!request) {
      await conn.rollback();
      return { requestNotFound: true };
    }
    const unit = await lockUnit(conn, unitCode);
    if (!unit) {
      await conn.rollback();
      return { unitNotFound: true };
    }
    if (unit.status !== 'RESERVED' || unit.reserved_for_request_id !== request.id) {
      await conn.rollback();
      return { notReserved: true, unit };
    }

    await conn.query(
      `UPDATE blood_units
       SET status = 'AVAILABLE', reserved_for_request_id = NULL, reserved_until = NULL, reserved_by = NULL
       WHERE id = ?`,
      [unit.id]
    );
    const requestStatus = await syncRequestStatus(conn, request.id);

    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES (?, 'RESERVATION_RELEASED', 'blood_unit', ?, ?)`,
      [userId, unit.unit_code, JSON.stringify({ requestCode: request.request_code })]
    );

    await conn.commit();
    return { request: { ...request, status: requestStatus }, unit: { ...unit, status: 'AVAILABLE' } };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * BBMS-F-042: Puts every unit whose hold has run out back in stock, writes a system audit row
 * for each (user_id NULL) and moves the affected requests back to PENDING.
 * @returns {Promise<Array<{ unitCode: string, requestId: number }>>}
 */
async function releaseExpiredReservations() {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [expired] = await conn.query(
      `SELECT id, unit_code, reserved_for_request_id, reserved_until
       FROM blood_units
       WHERE status = 'RESERVED' AND reserved_until IS NOT NULL AND reserved_until <= NOW()
       FOR UPDATE`
    );
    if (expired.length === 0) {
      await conn.commit();
      return [];
    }

    await conn.query(
      `UPDATE blood_units
       SET status = 'AVAILABLE', reserved_for_request_id = NULL, reserved_until = NULL, reserved_by = NULL
       WHERE id IN (?)`,
      [expired.map((row) => row.id)]
    );

    const requestIds = [...new Set(expired.map((row) => row.reserved_for_request_id).filter(Boolean))];
    for (const requestId of requestIds) {
      await syncRequestStatus(conn, requestId);
    }

    for (const row of expired) {
      await conn.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
         VALUES (NULL, 'RESERVATION_EXPIRED', 'blood_unit', ?, ?)`,
        [row.unit_code, JSON.stringify({ requestId: row.reserved_for_request_id, reservedUntil: row.reserved_until })]
      );
    }

    await conn.commit();
    return expired.map((row) => ({ unitCode: row.unit_code, requestId: row.reserved_for_request_id }));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * BBMS-F-042: Units currently held for a request, soonest hold expiry first.
 * secondsRemaining is worked out by the database, so the client countdown needs no clock sync.
 */
async function listReservationsForRequest(requestId, connection = null) {
  const runner = connection || db;
  const [rows] = await runner.query(
    `SELECT bu.id, bu.unit_code, bu.component, bu.blood_group, bu.volume_ml, bu.expires_at,
            bu.reserved_until, TIMESTAMPDIFF(SECOND, NOW(), bu.reserved_until) AS seconds_remaining,
            u.id AS reserved_by_id, u.full_name AS reserved_by_name
     FROM blood_units bu
     LEFT JOIN users u ON u.id = bu.reserved_by
     WHERE bu.reserved_for_request_id = ?
       AND bu.status = 'RESERVED'
       AND (bu.reserved_until IS NULL OR bu.reserved_until > NOW())
     ORDER BY bu.reserved_until ASC, bu.id ASC`,
    [requestId]
  );
  return rows.map((row) => ({
    unitId: row.id,
    unitCode: row.unit_code,
    component: row.component,
    bloodGroup: row.blood_group,
    volumeMl: row.volume_ml,
    unitExpiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    reservedUntil: row.reserved_until ? new Date(row.reserved_until).toISOString() : null,
    secondsRemaining: row.seconds_remaining === null ? null : Math.max(0, Number(row.seconds_remaining)),
    reservedBy: row.reserved_by_id ? { id: row.reserved_by_id, fullName: row.reserved_by_name } : null,
  }));
}

module.exports = {
  formatRequestCode,
  parseRequestCode,
  isValidRequestCode,
  generateNextRequestCode,
  createRequest,
  findByIdOrCode,
  listRequests,
  mapRowToRequest,
  findUnitByCode,
  createCrossmatch,
  findLatestCrossmatch,
  listCrossmatchesForRequest,
  countActiveReservations,
  reserveUnit,
  releaseReservation,
  releaseExpiredReservations,
  listReservationsForRequest,
};
