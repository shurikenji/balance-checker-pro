function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      totp_secret_encrypted TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      base_url TEXT NOT NULL,
      secret_encrypted TEXT,
      rate_multiplier REAL NOT NULL DEFAULT 1.0,
      status TEXT NOT NULL DEFAULT 'active',
      weight INTEGER NOT NULL DEFAULT 100,
      priority INTEGER NOT NULL DEFAULT 100,
      timeout_ms INTEGER NOT NULL DEFAULT 15000,
      max_concurrency INTEGER NOT NULL DEFAULT 1,
      cooldown_until TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS proxy_stats (
      proxy_id INTEGER PRIMARY KEY,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      avg_latency_ms REAL NOT NULL DEFAULT 0,
      last_success_at TEXT,
      last_failure_at TEXT,
      last_error TEXT,
      FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS check_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'batch',
      status TEXT NOT NULL DEFAULT 'queued',
      total_items INTEGER NOT NULL DEFAULT 0,
      processed_items INTEGER NOT NULL DEFAULT 0,
      success_items INTEGER NOT NULL DEFAULT 0,
      failed_items INTEGER NOT NULL DEFAULT 0,
      requested_proxy_id INTEGER,
      created_by_admin_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY (requested_proxy_id) REFERENCES proxies(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS check_job_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      line_number INTEGER NOT NULL,
      api_key_encrypted TEXT,
      api_key_mask TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      proxy_id INTEGER,
      response_time_ms INTEGER,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      FOREIGN KEY (job_id) REFERENCES check_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS check_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_item_id INTEGER NOT NULL UNIQUE,
      limit_usd TEXT NOT NULL,
      usage_usd TEXT NOT NULL,
      balance_usd TEXT NOT NULL,
      has_payment_method INTEGER NOT NULL DEFAULT 0,
      raw_response_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_item_id) REFERENCES check_job_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS single_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_mask TEXT NOT NULL,
      proxy_id INTEGER,
      status TEXT NOT NULL,
      response_time_ms INTEGER,
      error_code TEXT,
      error_message TEXT,
      rate_multiplier REAL,
      limit_usd TEXT,
      usage_usd TEXT,
      balance_usd TEXT,
      has_payment_method INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureColumn(db, 'proxies', 'rate_multiplier', 'REAL NOT NULL DEFAULT 1.0');
  ensureColumn(db, 'single_checks', 'rate_multiplier', 'REAL');

  const defaultSettings = [
    ['global_concurrency', '2'],
    ['per_proxy_concurrency', '1'],
    ['check_timeout_ms', '15000'],
    ['batch_retry_count', '1'],
    ['proxy_failure_threshold', '3'],
    ['proxy_cooldown_minutes', '10'],
  ];

  const insertSetting = db.prepare(`
    INSERT INTO system_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);

  const transaction = db.transaction(() => {
    for (const [key, value] of defaultSettings) {
      insertSetting.run(key, value);
    }
  });

  transaction();
}

function ensureColumn(db, tableName, columnName, columnSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`);
  }
}

module.exports = {
  runMigrations,
};
