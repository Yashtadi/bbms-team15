// Creates the database if it is missing, then runs schema.sql and seed.sql.
// Usage (inside server/): npm run db:setup
// WARNING: this deletes all existing data in the database.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true, // needed to run whole .sql files; never enable this in the app itself
  });

  const dbName = process.env.DB_NAME;
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
  );
  await connection.query(`USE \`${dbName}\``);

  for (const file of ['schema.sql', 'seed.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    await connection.query(sql);
    console.log(`Ran ${file}`);
  }

  await connection.end();
  console.log(`Database "${dbName}" is ready.`);
}

main().catch((err) => {
  console.error('Database setup failed:', err.message);
  process.exit(1);
});
