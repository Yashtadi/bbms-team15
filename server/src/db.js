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
});

module.exports = pool;
