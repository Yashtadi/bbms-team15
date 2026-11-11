const db = require('../../db');

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

module.exports = {
  formatRequestCode,
  parseRequestCode,
  isValidRequestCode,
  generateNextRequestCode,
  createRequest,
  findByIdOrCode,
  listRequests,
  mapRowToRequest,
};
