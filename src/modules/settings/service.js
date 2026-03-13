const { getDatabase } = require('../../db');

const SETTING_DEFINITIONS = [
  {
    key: 'global_concurrency',
    label: 'Global concurrency',
    description: 'Maximum number of batch items processed at the same time across the whole app.',
    inputType: 'number',
    min: 1,
    step: 1,
    defaultValue: '2',
  },
  {
    key: 'per_proxy_concurrency',
    label: 'Per-proxy concurrency',
    description: 'Maximum simultaneous requests allowed on a single proxy.',
    inputType: 'number',
    min: 1,
    step: 1,
    defaultValue: '1',
  },
  {
    key: 'check_timeout_ms',
    label: 'Check timeout (ms)',
    description: 'Timeout for billing requests through the selected proxy.',
    inputType: 'number',
    min: 1000,
    step: 1000,
    defaultValue: '15000',
  },
  {
    key: 'batch_retry_count',
    label: 'Batch retry count',
    description: 'How many times a failed batch item can be retried.',
    inputType: 'number',
    min: 0,
    step: 1,
    defaultValue: '1',
  },
  {
    key: 'proxy_failure_threshold',
    label: 'Proxy failure threshold',
    description: 'Consecutive proxy failures before the system marks it as cooldown.',
    inputType: 'number',
    min: 1,
    step: 1,
    defaultValue: '3',
  },
  {
    key: 'proxy_cooldown_minutes',
    label: 'Proxy cooldown (minutes)',
    description: 'Cooldown duration before a failed proxy becomes active again.',
    inputType: 'number',
    min: 1,
    step: 1,
    defaultValue: '10',
  },
];

function getSetting(key, fallbackValue = null) {
  const row = getDatabase()
    .prepare('SELECT value FROM system_settings WHERE key = ? LIMIT 1')
    .get(key);

  return row ? row.value : fallbackValue;
}

function getNumericSetting(key, fallbackValue) {
  const rawValue = getSetting(key, String(fallbackValue));
  const parsed = Number(rawValue);

  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function listSettings() {
  return SETTING_DEFINITIONS.map((definition) => ({
    ...definition,
    value: getSetting(definition.key, definition.defaultValue),
  }));
}

function updateSettings(values) {
  const db = getDatabase();
  const upsert = db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction(() => {
    for (const definition of SETTING_DEFINITIONS) {
      const rawValue = String(values[definition.key] ?? '').trim();

      if (!rawValue) {
        throw new Error(`${definition.label} is required`);
      }

      const numericValue = Number(rawValue);

      if (!Number.isFinite(numericValue)) {
        throw new Error(`${definition.label} must be a valid number`);
      }

      if (definition.min !== undefined && numericValue < definition.min) {
        throw new Error(`${definition.label} must be at least ${definition.min}`);
      }

      upsert.run(definition.key, rawValue);
    }
  });

  transaction();
}

module.exports = {
  getNumericSetting,
  getSetting,
  listSettings,
  updateSettings,
};
