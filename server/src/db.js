// Shared MySQL connection pool. Repositories use it like this:
//   const db = require('../../db');
//   const [rows] = await db.query('SELECT * FROM donors WHERE donor_code = ?', [code]);

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  // BBMS-NF-002: queue requests when all connections are busy instead of failing them,
  // fail fast if MySQL can't be reached, and keep idle connections alive so a quiet
  // period does not leave the pool holding dead sockets.
  waitForConnections: true,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  // Keep MySQL DATE columns (e.g. date_of_birth) as clean 'YYYY-MM-DD' strings
  // to avoid timezone shifting when serialised to JSON
  dateStrings: ['DATE'],
});

module.exports = pool;
