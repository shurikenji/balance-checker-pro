const argon2 = require('argon2');

const { getDatabase } = require('../../db');

function findAdminByUsername(username) {
  return getDatabase()
    .prepare('SELECT * FROM admin_users WHERE username = ? LIMIT 1')
    .get(username);
}

async function verifyAdminCredentials(username, password) {
  const admin = findAdminByUsername(username);

  if (!admin || admin.status !== 'active') {
    return null;
  }

  const valid = await argon2.verify(admin.password_hash, password);

  if (!valid) {
    return null;
  }

  getDatabase()
    .prepare('UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(admin.id);

  return {
    id: admin.id,
    username: admin.username,
  };
}

module.exports = {
  findAdminByUsername,
  verifyAdminCredentials,
};
