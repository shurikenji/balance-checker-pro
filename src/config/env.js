const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');

function resolveDbPath(dbPath) {
  if (!dbPath) {
    return path.join(rootDir, 'data', 'app.db');
  }

  return path.isAbsolute(dbPath) ? dbPath : path.resolve(rootDir, dbPath);
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  rootDir,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  dbPath: resolveDbPath(process.env.DB_PATH),
  encryptionKey: process.env.ENCRYPTION_KEY || 'change-this-32-byte-encryption-key',
  workerEnabled: String(process.env.WORKER_ENABLED || 'true').toLowerCase() !== 'false',
  workerPollMs: Number(process.env.WORKER_POLL_MS || 3000),
  adminIpAllowlist: parseList(process.env.ADMIN_IP_ALLOWLIST),
};
