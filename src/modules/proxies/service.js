const axios = require('axios');

const { getDatabase } = require('../../db');

function listProxies() {
  return getDatabase()
    .prepare(
      `
        SELECT
          p.*,
          COALESCE(ps.success_count, 0) AS success_count,
          COALESCE(ps.failure_count, 0) AS failure_count,
          COALESCE(ps.consecutive_failures, 0) AS consecutive_failures,
          COALESCE(ps.avg_latency_ms, 0) AS avg_latency_ms,
          ps.last_success_at,
          ps.last_failure_at,
          ps.last_error
        FROM proxies p
        LEFT JOIN proxy_stats ps ON ps.proxy_id = p.id
        ORDER BY p.priority ASC, p.id ASC
      `
    )
    .all();
}

function getProxyById(id) {
  return getDatabase()
    .prepare(
      `
        SELECT
          p.*,
          COALESCE(ps.success_count, 0) AS success_count,
          COALESCE(ps.failure_count, 0) AS failure_count,
          COALESCE(ps.consecutive_failures, 0) AS consecutive_failures,
          COALESCE(ps.avg_latency_ms, 0) AS avg_latency_ms,
          ps.last_success_at,
          ps.last_failure_at,
          ps.last_error
        FROM proxies p
        LEFT JOIN proxy_stats ps ON ps.proxy_id = p.id
        WHERE p.id = ?
        LIMIT 1
      `
    )
    .get(id);
}

function getProxySummary() {
  return getDatabase()
    .prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled,
          0 AS cooldown
        FROM proxies
      `
    )
    .get();
}

function listActiveProxies() {
  return listProxies().filter((proxy) => proxy.status === 'active');
}

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || '').trim();
  return value.replace(/\/+$/, '');
}

function createProxy(input) {
  const db = getDatabase();
  const payload = normalizeProxyInput(input);
  let result;

  try {
    result = db
      .prepare(
        `
          INSERT INTO proxies (
            name,
            base_url,
            rate_multiplier,
            status,
            weight,
            priority,
            timeout_ms,
            max_concurrency,
            notes
          )
          VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
        `
      )
      .run(
        payload.name,
        payload.baseUrl,
        payload.rateMultiplier,
        payload.weight,
        payload.priority,
        payload.timeoutMs,
        payload.maxConcurrency,
        payload.notes || null
      );
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('Proxy name already exists');
    }

    throw error;
  }

  db.prepare(
    `
      INSERT INTO proxy_stats (proxy_id)
      VALUES (?)
      ON CONFLICT(proxy_id) DO NOTHING
    `
  ).run(result.lastInsertRowid);

  return getProxyById(result.lastInsertRowid);
}

function updateProxy(id, input) {
  const db = getDatabase();
  const existing = getProxyById(id);

  if (!existing) {
    throw new Error('Proxy not found');
  }

  const payload = normalizeProxyInput(input);

  try {
    db.prepare(
      `
        UPDATE proxies
        SET
          name = ?,
          base_url = ?,
          rate_multiplier = ?,
          weight = ?,
          priority = ?,
          timeout_ms = ?,
          max_concurrency = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(
      payload.name,
      payload.baseUrl,
      payload.rateMultiplier,
      payload.weight,
      payload.priority,
      payload.timeoutMs,
      payload.maxConcurrency,
      payload.notes || null,
      id
    );
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('Proxy name already exists');
    }

    throw error;
  }

  return getProxyById(id);
}

function deleteProxy(id) {
  const db = getDatabase();
  const existing = getProxyById(id);

  if (!existing) {
    throw new Error('Proxy not found');
  }

  const activeUsage = db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM check_jobs WHERE requested_proxy_id = ? AND status IN ('queued', 'running')) AS active_jobs,
          (SELECT COUNT(*) FROM check_job_items WHERE proxy_id = ? AND status IN ('pending', 'running')) AS active_items
      `
    )
    .get(id, id);

  if (Number(activeUsage.active_jobs || 0) > 0 || Number(activeUsage.active_items || 0) > 0) {
    throw new Error('Proxy is currently used by active jobs and cannot be deleted');
  }

  db.prepare('DELETE FROM proxies WHERE id = ?').run(id);
}

function normalizeProxyInput(input) {
  const name = String(input.name || '').trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const notes = String(input.notes || '').trim();
  const timeoutMs = Number(input.timeoutMs || 15000);
  const rateMultiplier = Number(input.rateMultiplier || 1);
  const weight = Number(input.weight || 100);
  const priority = Number(input.priority || 100);
  const maxConcurrency = Number(input.maxConcurrency || 1);

  if (!name) {
    throw new Error('Proxy name is required');
  }

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error('Proxy base URL must start with http:// or https://');
  }

  if (!Number.isFinite(rateMultiplier) || rateMultiplier <= 0) {
    throw new Error('Rate multiplier must be greater than 0');
  }

  return {
    name,
    baseUrl,
    notes,
    timeoutMs,
    rateMultiplier,
    weight,
    priority,
    maxConcurrency,
  };
}

function updateProxyStatus(id, status) {
  getDatabase()
    .prepare(
      `
        UPDATE proxies
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    )
    .run(status, id);
}

function updateProxyStatsSuccess(id, latencyMs, statusCode) {
  const db = getDatabase();
  const current = db.prepare('SELECT * FROM proxy_stats WHERE proxy_id = ?').get(id);

  if (!current) {
    db.prepare('INSERT INTO proxy_stats (proxy_id) VALUES (?)').run(id);
  }

  const existing = db.prepare('SELECT * FROM proxy_stats WHERE proxy_id = ?').get(id);
  const nextSuccessCount = Number(existing.success_count || 0) + 1;
  const currentAvg = Number(existing.avg_latency_ms || 0);
  const nextAvg =
    nextSuccessCount === 1 ? latencyMs : ((currentAvg * (nextSuccessCount - 1)) + latencyMs) / nextSuccessCount;

  db.prepare(
    `
      UPDATE proxy_stats
      SET
        success_count = ?,
        consecutive_failures = 0,
        avg_latency_ms = ?,
        last_success_at = CURRENT_TIMESTAMP,
        last_error = ?
      WHERE proxy_id = ?
    `
  ).run(nextSuccessCount, nextAvg, `Reachable (${statusCode})`, id);
}

function updateProxyStatsFailure(id, errorMessage) {
  const db = getDatabase();
  const current = db.prepare('SELECT * FROM proxy_stats WHERE proxy_id = ?').get(id);

  if (!current) {
    db.prepare('INSERT INTO proxy_stats (proxy_id) VALUES (?)').run(id);
  }

  const existing = db.prepare('SELECT * FROM proxy_stats WHERE proxy_id = ?').get(id);

  db.prepare(
    `
      UPDATE proxy_stats
      SET
        failure_count = ?,
        consecutive_failures = ?,
        last_failure_at = CURRENT_TIMESTAMP,
        last_error = ?
      WHERE proxy_id = ?
    `
  ).run(
    Number(existing.failure_count || 0) + 1,
    Number(existing.consecutive_failures || 0) + 1,
    errorMessage,
    id
  );
}

async function testProxyConnectivity(id) {
  const proxy = getProxyById(id);

  if (!proxy) {
    throw new Error('Proxy not found');
  }

  const startedAt = Date.now();

  try {
    const response = await axios.get(proxy.base_url, {
      timeout: proxy.timeout_ms,
      validateStatus: () => true,
      maxRedirects: 0,
    });

    const latencyMs = Date.now() - startedAt;
    updateProxyStatsSuccess(proxy.id, latencyMs, response.status);

    return {
      ok: true,
      latencyMs,
      statusCode: response.status,
      message: `Proxy reachable with HTTP ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    let message = error.code || error.message || 'Unknown connectivity error';

    if (error.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY') {
      message = 'TLS certificate could not be verified';
    }

    updateProxyStatsFailure(proxy.id, message);

    return {
      ok: false,
      latencyMs,
      statusCode: null,
      message,
    };
  }
}

module.exports = {
  createProxy,
  deleteProxy,
  getProxyById,
  getProxySummary,
  listActiveProxies,
  listProxies,
  testProxyConnectivity,
  updateProxy,
  updateProxyStatsFailure,
  updateProxyStatsSuccess,
  updateProxyStatus,
};
