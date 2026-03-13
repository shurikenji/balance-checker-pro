const axios = require('axios');

function validateApiKey(apiKey) {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(String(apiKey || ''));
}

function joinUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${path}`;
}

async function fetchBillingData(proxy, apiKey, timeoutMs) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };

  const startedAt = Date.now();

  try {
    const [subscriptionRes, usageRes] = await Promise.all([
      axios.get(joinUrl(proxy.base_url, '/v1/dashboard/billing/subscription'), {
        headers,
        timeout: timeoutMs || proxy.timeout_ms,
      }),
      axios.get(joinUrl(proxy.base_url, '/v1/dashboard/billing/usage'), {
        headers,
        timeout: timeoutMs || proxy.timeout_ms,
      }),
    ]);

    const latencyMs = Date.now() - startedAt;
    const rawLimit = Number(subscriptionRes.data.hard_limit_usd || 0);
    const rawUsage = Number(usageRes.data.total_usage || 0) / 100;
    const rateMultiplier = normalizeRateMultiplier(proxy.rate_multiplier);
    const limit = rawLimit / rateMultiplier;
    const usage = rawUsage / rateMultiplier;
    const balance = Math.max(0, limit - usage);

    return {
      latencyMs,
      data: {
        limit_usd: limit.toFixed(2),
        usage_usd: usage.toFixed(2),
        balance_usd: balance.toFixed(2),
        has_payment_method: Boolean(subscriptionRes.data.has_payment_method),
        rate_multiplier: rateMultiplier,
      },
      rawResponse: {
        subscription: subscriptionRes.data,
        usage: usageRes.data,
      },
    };
  } catch (error) {
    const status = error.response ? Number(error.response.status) : null;
    const upstreamError = error.response?.data?.error || {};
    const message =
      upstreamError.message ||
      error.code ||
      error.message ||
      'Failed to check balance';

    const normalized = normalizeUpstreamError(status, message, upstreamError);
    const enriched = new Error(normalized.message);

    enriched.code = normalized.code;
    enriched.retryable = normalized.retryable;
    enriched.status = status;
    enriched.latencyMs = Date.now() - startedAt;

    throw enriched;
  }
}

function normalizeRateMultiplier(value) {
  const parsed = Number(value || 1);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeUpstreamError(status, message, upstreamError = {}) {
  const normalizedMessage = String(message || '').toLowerCase();
  const upstreamCode = String(upstreamError.code || '').toLowerCase();
  const upstreamType = String(upstreamError.type || '').toLowerCase();

  if (
    upstreamCode === 'insufficient_quota' ||
    upstreamType === 'insufficient_quota' ||
    normalizedMessage.includes('insufficient_quota') ||
    normalizedMessage.includes('quota exhausted') ||
    normalizedMessage.includes('quota exceeded') ||
    normalizedMessage.includes('quota has been exhausted') ||
    normalizedMessage.includes('exceeded your current quota') ||
    normalizedMessage.includes('billing hard limit') ||
    normalizedMessage.includes('negative balance') ||
    normalizedMessage.includes('余额不足') ||
    normalizedMessage.includes('额度已用尽') ||
    normalizedMessage.includes('额度不足') ||
    normalizedMessage.includes('é¢åº¦å·²ç”¨å°½') ||
    normalizedMessage.includes('é¢åº¦ä¸è¶³')
  ) {
    return {
      code: 'quota_exhausted',
      message: 'Quota exhausted',
      retryable: false,
    };
  }

  if (normalizedMessage.includes('invalid api key') || normalizedMessage.includes('incorrect api key')) {
    return {
      code: 'invalid_api_key',
      message: 'Invalid API key',
      retryable: false,
    };
  }

  if (status === 401) {
    return {
      code: 'unauthorized',
      message: 'Unauthorized API key',
      retryable: false,
    };
  }

  if (status === 429) {
    return {
      code: 'rate_limited',
      message: 'Upstream rate limited',
      retryable: true,
    };
  }

  if (status && status >= 500) {
    return {
      code: 'upstream_5xx',
      message: 'Upstream server error',
      retryable: true,
    };
  }

  if (normalizedMessage.includes('timeout') || normalizedMessage.includes('aborted')) {
    return {
      code: 'timeout',
      message: 'Request timed out',
      retryable: true,
    };
  }

  if (normalizedMessage.includes('network') || normalizedMessage.includes('econn') || normalizedMessage.includes('socket')) {
    return {
      code: 'network_error',
      message: 'Network error while contacting proxy',
      retryable: true,
    };
  }

  return {
    code: 'check_failed',
    message: String(message || 'Failed to check balance'),
    retryable: false,
  };
}

module.exports = {
  fetchBillingData,
  validateApiKey,
};
