const { getDatabase } = require('../../db');
const { fetchBillingData, validateApiKey } = require('../checks/service');
const {
  getProxyById,
  listActiveProxies,
  updateProxyStatsFailure,
  updateProxyStatsSuccess,
} = require('../proxies/service');

function maskApiKey(apiKey) {
  if (!apiKey || apiKey.length < 10) {
    return '***';
  }

  return `${apiKey.slice(0, 5)}***${apiKey.slice(-4)}`;
}

function getSelectableServers() {
  return listActiveProxies();
}

function getSelectableServerSummary() {
  return getSelectableServers().map((server) => ({
    server_id: server.id,
    name: server.name,
  }));
}

function resolveSelectableServer(input = {}) {
  const serverId = normalizeServerId(input.serverId);

  if (!serverId) {
    return null;
  }

  const server = getProxyById(serverId);
  return server && server.status === 'active' ? server : null;
}

async function runSingleCheck({ apiKey, serverId }) {
  if (!validateApiKey(apiKey)) {
    throw createUserError('Invalid API key format. Must start with sk-', 'invalid_api_key');
  }

  const server = resolveSelectableServer({ serverId });

  if (!server || server.status !== 'active') {
    throw createUserError('Selected server is unavailable', 'invalid_proxy');
  }

  try {
    const result = await fetchBillingData(server, apiKey, server.timeout_ms);
    updateProxyStatsSuccess(server.id, result.latencyMs, 'Billing OK');

    const singleCheckId = createSingleCheckLog({
      apiKeyMask: maskApiKey(apiKey),
      proxyId: server.id,
      status: 'success',
      responseTimeMs: result.latencyMs,
      data: result.data,
    });

    return {
      id: singleCheckId,
      server,
      latencyMs: result.latencyMs,
      data: result.data,
    };
  } catch (error) {
    updateProxyStatsFailure(server.id, error.message);

    createSingleCheckLog({
      apiKeyMask: maskApiKey(apiKey),
      proxyId: server.id,
      status: 'failed',
      responseTimeMs: error.latencyMs || null,
      errorCode: error.code || 'check_failed',
      errorMessage: error.message || 'Failed to check balance',
    });

    throw createUserError(error.message || 'Failed to check balance', error.code || 'check_failed');
  }
}

function createSingleCheckLog({ apiKeyMask, proxyId, status, responseTimeMs, errorCode, errorMessage, data }) {
  const result = getDatabase()
    .prepare(
      `
        INSERT INTO single_checks (
          api_key_mask,
          proxy_id,
          status,
          response_time_ms,
          error_code,
          error_message,
          rate_multiplier,
          limit_usd,
          usage_usd,
          balance_usd,
          has_payment_method
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      apiKeyMask,
      proxyId || null,
      status,
      responseTimeMs || null,
      errorCode || null,
      errorMessage || null,
      data ? data.rate_multiplier : null,
      data ? data.limit_usd : null,
      data ? data.usage_usd : null,
      data ? data.balance_usd : null,
      data ? (data.has_payment_method ? 1 : 0) : null
    );

  return result.lastInsertRowid;
}

function createUserError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeServerId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

module.exports = {
  getSelectableServerSummary,
  getSelectableServers,
  resolveSelectableServer,
  runSingleCheck,
};
