const env = require('../../config/env');
const { fetchBillingData, validateApiKey } = require('../../modules/checks/service');
const {
  decryptBatchItemApiKey,
  getNextPendingItem,
  listRunnableJobs,
  markBatchItemFailure,
  markBatchItemSuccess,
  reserveJobItem,
} = require('../../modules/batch/service');
const { updateProxyStatsFailure, updateProxyStatsSuccess } = require('../../modules/proxies/service');
const { getNumericSetting } = require('../../modules/settings/service');
const { pickProxy } = require('../proxy-router');

let timer;
let loopActive = false;
let activeTasks = 0;
const activeProxyCounts = new Map();

function startBatchWorker() {
  if (!env.workerEnabled || timer) {
    return;
  }

  runWorkerTick();
  timer = setInterval(runWorkerTick, env.workerPollMs);
}

function stopBatchWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function runWorkerTick() {
  if (loopActive) {
    return;
  }

  loopActive = true;

  Promise.resolve()
    .then(async () => {
      const globalConcurrency = Math.max(1, getNumericSetting('global_concurrency', 2));

      while (activeTasks < globalConcurrency) {
        const task = reserveNextTask();

        if (!task) {
          break;
        }

        activeTasks += 1;
        incrementProxyCount(task.proxy.id);
        processReservedTask(task)
          .catch((error) => {
            console.error('Batch worker task failed unexpectedly:', error);
          })
          .finally(() => {
            activeTasks -= 1;
            decrementProxyCount(task.proxy.id);
          });
      }
    })
    .finally(() => {
      loopActive = false;
    });
}

function reserveNextTask() {
  const jobs = listRunnableJobs();

  for (const job of jobs) {
    const item = getNextPendingItem(job.id);

    if (!item) {
      continue;
    }

    const proxy = pickProxy({
      requestedProxyId: job.requested_proxy_id,
      activeProxyCounts,
    });

    if (!proxy) {
      continue;
    }

    const reserved = reserveJobItem(job.id, item.id);

    if (!reserved) {
      continue;
    }

    return {
      job,
      item,
      proxy,
    };
  }

  return null;
}

async function processReservedTask(task) {
  const retryCount = Math.max(0, getNumericSetting('batch_retry_count', 1));
  const timeoutMs = Math.max(1000, getNumericSetting('check_timeout_ms', 15000));
  const maxAttempts = task.job.requested_proxy_id ? 1 : retryCount + 1;
  const excludedProxyIds = [];
  const apiKey = decryptBatchItemApiKey(task.item);

  if (!validateApiKey(apiKey)) {
    markBatchItemFailure({
      itemId: task.item.id,
      jobId: task.job.id,
      proxyId: null,
      responseTimeMs: null,
      errorCode: 'invalid_api_key',
      errorMessage: 'Invalid API key format',
      attemptsUsed: 0,
    });
    return;
  }

  let attemptsUsed = 0;
  let lastError = null;
  let lastProxyId = task.proxy.id;

  for (let index = 0; index < maxAttempts; index += 1) {
    const proxy =
      index === 0
        ? task.proxy
        : pickProxy({
            requestedProxyId: task.job.requested_proxy_id,
            activeProxyCounts,
            excludedProxyIds,
          });

    if (!proxy) {
      break;
    }

    attemptsUsed += 1;
    lastProxyId = proxy.id;

    try {
      const result = await fetchBillingData(proxy, apiKey, timeoutMs);
      updateProxyStatsSuccess(proxy.id, result.latencyMs, 'Billing OK');
      markBatchItemSuccess({
        itemId: task.item.id,
        jobId: task.job.id,
        proxyId: proxy.id,
        responseTimeMs: result.latencyMs,
        result,
        attemptsUsed,
      });
      return;
    } catch (error) {
      lastError = error;
      updateProxyStatsFailure(proxy.id, error.message);
      excludedProxyIds.push(proxy.id);

      if (task.job.requested_proxy_id || !error.retryable) {
        break;
      }
    }
  }

  markBatchItemFailure({
    itemId: task.item.id,
    jobId: task.job.id,
    proxyId: lastProxyId,
    responseTimeMs: lastError ? lastError.latencyMs : null,
    errorCode: lastError ? lastError.code : 'no_proxy_available',
    errorMessage: lastError ? lastError.message : 'No proxy currently available for this item',
    attemptsUsed,
  });
}

function incrementProxyCount(proxyId) {
  activeProxyCounts.set(proxyId, (activeProxyCounts.get(proxyId) || 0) + 1);
}

function decrementProxyCount(proxyId) {
  const nextCount = (activeProxyCounts.get(proxyId) || 1) - 1;

  if (nextCount <= 0) {
    activeProxyCounts.delete(proxyId);
    return;
  }

  activeProxyCounts.set(proxyId, nextCount);
}

module.exports = {
  startBatchWorker,
  stopBatchWorker,
};
