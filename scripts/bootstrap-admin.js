require('dotenv').config();

const argon2 = require('argon2');

const env = require('../src/config/env');
const { initializeDatabase } = require('../src/db');

async function main() {
  const username = process.argv[2] || process.env.ADMIN_BOOTSTRAP_USERNAME;
  const password = process.argv[3] || process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!username || !password) {
    console.error('Usage: npm run admin:bootstrap -- <username> <password>');
    process.exit(1);
  }

  const db = initializeDatabase();
  const passwordHash = await argon2.hash(password);

  db.prepare(
    `
      INSERT INTO admin_users (username, password_hash, status)
      VALUES (?, ?, 'active')
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    `
  ).run(username, passwordHash);

  console.log(`Admin account ready for username: ${username}`);
  console.log(`Database path: ${env.dbPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
