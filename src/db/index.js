const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const env = require('../config/env');
const { runMigrations } = require('./migrate');

let database;

function ensureDatabaseDirectory(dbPath) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
}

function configureDatabase(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
}

function initializeDatabase() {
  if (database) {
    return database;
  }

  ensureDatabaseDirectory(env.dbPath);

  database = new Database(env.dbPath);
  configureDatabase(database);
  runMigrations(database);

  return database;
}

function getDatabase() {
  if (!database) {
    return initializeDatabase();
  }

  return database;
}

module.exports = {
  getDatabase,
  initializeDatabase,
};
