const express = require('express');

const { getSelectableServers, getSelectableServerSummary, resolveSelectableServer, runSingleCheck } = require('./service');

const router = express.Router();

function renderCheckPage(res) {
  return res.render('public/check', {
    title: 'Check Balance',
    servers: getSelectableServers(),
  });
}

router.get('/check', (req, res) => res.redirect(301, '/check-balance'));
router.get('/check-balance', (req, res) => renderCheckPage(res));

router.get('/api/servers', (req, res) => {
  return res.json({
    ok: true,
    servers: getSelectableServerSummary(),
  });
});

router.post('/api/check', async (req, res) => {
  const apiKey = String(req.body.api_key || req.body.apiKey || '').trim();
  const serverId = String(req.body.server_id || req.body.serverId || '').trim();

  if (!apiKey) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'missing_api_key',
        message: 'api_key is required',
      },
    });
  }

  if (!serverId) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'missing_server',
        message: 'server_id is required',
      },
    });
  }

  const server = resolveSelectableServer({ serverId });

  if (!server) {
    return res.status(404).json({
      ok: false,
      error: {
        code: 'invalid_proxy',
        message: 'Selected server is unavailable',
      },
    });
  }

  try {
    const result = await runSingleCheck({
      apiKey,
      serverId: server.id,
    });

    return res.json({
      ok: true,
      server_id: result.server.id,
      server_name: result.server.name,
      latency_ms: result.latencyMs,
      limit_usd: result.data.limit_usd,
      usage_usd: result.data.usage_usd,
      balance_usd: result.data.balance_usd,
    });
  } catch (error) {
    const status = getApiErrorStatus(error.code);

    return res.status(status).json({
      ok: false,
      error: {
        code: error.code || 'check_failed',
        message: error.message || 'Failed to check balance',
      },
    });
  }
});

function getApiErrorStatus(code) {
  if (code === 'invalid_api_key' || code === 'missing_api_key' || code === 'missing_server') {
    return 400;
  }

  if (code === 'quota_exhausted') {
    return 402;
  }

  if (code === 'invalid_proxy') {
    return 404;
  }

  if (code === 'rate_limited' || code === 'timeout' || code === 'network_error' || code === 'upstream_5xx') {
    return 502;
  }

  return 500;
}

module.exports = router;
