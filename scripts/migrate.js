require('dotenv').config();

const env = require('../src/config/env');
const { initializeDatabase } = require('../src/db');

initializeDatabase();

console.log(`Database initialized at ${env.dbPath}`);
