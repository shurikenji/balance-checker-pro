require('dotenv').config();

const env = require('./config/env');
const app = require('./app');
const { initializeDatabase } = require('./db');
const { startBatchWorker } = require('./services/batch-worker');

initializeDatabase();
startBatchWorker();

app.listen(env.port, () => {
  console.log(`Server listening on http://localhost:${env.port}`);
  console.log(`Database path: ${env.dbPath}`);
  console.log(`Batch worker enabled: ${env.workerEnabled}`);
});
