const Database = require('better-sqlite3');
const session = require('express-session');
const SQLiteStoreFactory = require('better-sqlite3-session-store');

const env = require('../../config/env');

const SQLiteStore = SQLiteStoreFactory(session);

let sessionStore;

function getSessionStore() {
  if (sessionStore) {
    return sessionStore;
  }

  const client = new Database(env.sessionDbPath);
  client.pragma('journal_mode = WAL');
  client.pragma('busy_timeout = 5000');

  sessionStore = new SQLiteStore({
    client,
    expired: {
      clear: true,
      intervalMs: env.sessionCleanupIntervalMs,
    },
  });

  return sessionStore;
}

module.exports = {
  getSessionStore,
};
