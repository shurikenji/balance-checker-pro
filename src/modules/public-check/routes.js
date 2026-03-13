const express = require('express');

const { getSelectableProxies, runSingleCheck } = require('./service');

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

module.exports = router;
