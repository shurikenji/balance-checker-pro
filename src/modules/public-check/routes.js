const express = require('express');

const { getSelectableProxies, getSelectableProxySummary, resolveSelectableProxy, runSingleCheck } = require('./service');

const router = express.Router();

function renderCheckPage(res, payload = {}) {
  return res.render('public/check', {
    title: 'Check Balance',
    proxies: getSelectableProxies(),
    form: {
      proxyId: payload.proxyId || '',
      apiKey: payload.apiKey || '',
    },
    result: payload.result || null,
    error: payload.error || '',
  });
}

router.get('/check', (req, res) => renderCheckPage(res));

router.get('/api/servers', (req, res) => {
  return res.json({
    ok: true,
    servers: getSelectableProxySummary(),
  });
});

router.post('/api/check', async (req, res) => {
  const apiKey = String(req.body.api_key || req.body.apiKey || '').trim();
  const proxyId = String(req.body.proxy_id || req.body.proxyId || '').trim();
  const server = String(req.body.server || '').trim();

  if (!apiKey) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'missing_api_key',
        message: 'api_key is required',
      },
    });
  }

  if (!proxyId && !server) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'missing_server',
        message: 'server or proxy_id is required',
      },
    });
  }

  const proxy = resolveSelectableProxy({
    proxyId,
    server,
  });

  if (!proxy) {
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
      proxyId: proxy.id,
    });

    return res.json({
      ok: true,
      server: {
        id: result.proxy.id,
        name: result.proxy.name,
      },
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

router.post('/check', async (req, res) => {
  const proxyId = String(req.body.proxy_id || '').trim();
  const apiKey = String(req.body.api_key || '').trim();

  if (!proxyId) {
    return renderCheckPage(res, {
      proxyId,
      apiKey,
      error: 'Please choose a server',
    });
  }

  try {
    const result = await runSingleCheck({
      apiKey,
      proxyId: Number(proxyId),
    });

    return renderCheckPage(res, {
      proxyId,
      result,
    });
  } catch (error) {
    return renderCheckPage(res, {
      proxyId,
      apiKey,
      error: error.message,
    });
  }
});

function getApiErrorStatus(code) {
  if (code === 'invalid_api_key' || code === 'missing_api_key' || code === 'missing_server') {
    return 400;
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
