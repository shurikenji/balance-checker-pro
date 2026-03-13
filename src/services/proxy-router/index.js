const { getNumericSetting } = require('../../modules/settings/service');
const { getProxyById, listProxies } = require('../../modules/proxies/service');

function listCandidateProxies() {
  return listProxies()
    .filter((proxy) => proxy.status === 'active')
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      if (left.consecutive_failures !== right.consecutive_failures) {
        return left.consecutive_failures - right.consecutive_failures;
      }

      if (left.weight !== right.weight) {
        return right.weight - left.weight;
      }

      return left.avg_latency_ms - right.avg_latency_ms;
    });
}

function pickProxy({ requestedProxyId, activeProxyCounts, excludedProxyIds = [] }) {
  const excluded = new Set(excludedProxyIds);

  if (requestedProxyId) {
    const proxy = getProxyById(requestedProxyId);

    if (!proxy || !isProxyUsable(proxy, activeProxyCounts, excluded)) {
      return null;
    }

    return proxy;
  }

  const candidates = listCandidateProxies();

  for (const proxy of candidates) {
    if (isProxyUsable(proxy, activeProxyCounts, excluded)) {
      return proxy;
    }
  }

  return null;
}

function isProxyUsable(proxy, activeProxyCounts, excluded) {
  if (!proxy || excluded.has(proxy.id)) {
    return false;
  }

  const activeCount = activeProxyCounts.get(proxy.id) || 0;
  const maxConcurrency = Math.max(1, Number(proxy.max_concurrency || getNumericSetting('per_proxy_concurrency', 1)));

  if (proxy.status === 'disabled') {
    return false;
  }

  return activeCount < maxConcurrency;
}

module.exports = {
  listCandidateProxies,
  pickProxy,
};
