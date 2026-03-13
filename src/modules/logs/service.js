const { getDatabase } = require('../../db');

function listCheckLogs(filters = {}) {
  const db = getDatabase();
  const conditions = [];
  const params = [];

  if (filters.type === 'single') {
    conditions.push(`source_type = 'single'`);
  } else if (filters.type === 'batch') {
    conditions.push(`source_type = 'batch'`);
  }

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  if (filters.proxyId) {
    conditions.push('proxy_id = ?');
    params.push(Number(filters.proxyId));
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(Number(filters.limit || 100), 500));

  return db
    .prepare(
      `
        SELECT *
        FROM (
          SELECT
            'single' AS source_type,
            sc.id AS source_id,
            sc.created_at,
            sc.api_key_mask,
            sc.status,
            sc.proxy_id,
            p.name AS proxy_name,
            sc.response_time_ms,
            sc.error_code,
            sc.error_message,
            sc.limit_usd,
            sc.usage_usd,
            sc.balance_usd,
            sc.has_payment_method
          FROM single_checks sc
          LEFT JOIN proxies p ON p.id = sc.proxy_id

          UNION ALL

          SELECT
            'batch' AS source_type,
            cji.id AS source_id,
            cji.created_at,
            cji.api_key_mask,
            cji.status,
            cji.proxy_id,
            p.name AS proxy_name,
            cji.response_time_ms,
            cji.error_code,
            cji.error_message,
            cr.limit_usd,
            cr.usage_usd,
            cr.balance_usd,
            cr.has_payment_method
          FROM check_job_items cji
          LEFT JOIN proxies p ON p.id = cji.proxy_id
          LEFT JOIN check_results cr ON cr.job_item_id = cji.id
        ) logs
        ${whereClause}
        ORDER BY created_at DESC, source_id DESC
        LIMIT ?
      `
    )
    .all(...params, limit);
}

module.exports = {
  listCheckLogs,
};
