const { getDatabase } = require('../../db');
const { decryptText, encryptText } = require('../../services/encryption');

function maskApiKey(apiKey) {
  if (!apiKey || apiKey.length < 10) {
    return '***';
  }

  return `${apiKey.slice(0, 5)}***${apiKey.slice(-4)}`;
}

function parseBatchFileContent(content, originalName) {
  const raw = String(content || '').replace(/^\uFEFF/, '');
  const ext = String(originalName || '').toLowerCase();

  if (ext.endsWith('.csv')) {
    return parseCsvKeys(raw);
  }

  return parseTextKeys(raw);
}

function parseTextKeys(content) {
  return content
    .split(/\r?\n/)
    .map((line, index) => ({
      lineNumber: index + 1,
      apiKey: line.trim(),
    }))
    .filter((item) => item.apiKey);
}

function parseCsvKeys(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const headers = lines[0].split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
  const apiKeyIndex = headers.findIndex((header) => header.toLowerCase() === 'api_key');

  if (apiKeyIndex >= 0) {
    return lines.slice(1).map((line, index) => {
      const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
      return {
        lineNumber: index + 2,
        apiKey: cells[apiKeyIndex] || '',
      };
    }).filter((item) => item.apiKey);
  }

  return lines.map((line, index) => {
    const firstCell = line.split(',')[0].trim().replace(/^"|"$/g, '');
    return {
      lineNumber: index + 1,
      apiKey: firstCell,
    };
  }).filter((item) => item.apiKey);
}

function validateBatchItems(items) {
  const accepted = [];
  const rejected = [];

  for (const item of items) {
    if (/^sk-[A-Za-z0-9_-]{20,}$/.test(item.apiKey)) {
      accepted.push(item);
    } else {
      rejected.push(item);
    }
  }

  return { accepted, rejected };
}

function createBatchJob({ fileName, fileContent, requestedProxyId, adminUserId }) {
  if (!requestedProxyId) {
    throw new Error('You must choose a proxy/server for this batch');
  }

  const parsedItems = parseBatchFileContent(fileContent, fileName);
  const { accepted, rejected } = validateBatchItems(parsedItems);

  if (!accepted.length) {
    throw new Error('No valid API keys found in uploaded file');
  }

  const db = getDatabase();
  const createJob = db.prepare(`
    INSERT INTO check_jobs (
      type,
      status,
      total_items,
      requested_proxy_id,
      created_by_admin_id
    )
    VALUES ('batch', 'queued', ?, ?, ?)
  `);

  const createItem = db.prepare(`
    INSERT INTO check_job_items (
      job_id,
      line_number,
      api_key_encrypted,
      api_key_mask,
      status
    )
    VALUES (?, ?, ?, ?, 'pending')
  `);

  const transaction = db.transaction(() => {
    const jobResult = createJob.run(
      accepted.length,
      requestedProxyId,
      adminUserId || null
    );

    for (const item of accepted) {
      createItem.run(
        jobResult.lastInsertRowid,
        item.lineNumber,
        encryptText(item.apiKey),
        maskApiKey(item.apiKey)
      );
    }

    return jobResult.lastInsertRowid;
  });

  const jobId = transaction();

  return {
    job: getBatchJobById(jobId),
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
  };
}

function listBatchJobs() {
  return getDatabase()
    .prepare(`
      SELECT
        cj.*,
        p.name AS requested_proxy_name,
        au.username AS created_by_username
      FROM check_jobs cj
      LEFT JOIN proxies p ON p.id = cj.requested_proxy_id
      LEFT JOIN admin_users au ON au.id = cj.created_by_admin_id
      ORDER BY cj.id DESC
    `)
    .all();
}

function getBatchJobById(id) {
  return getDatabase()
    .prepare(`
      SELECT
        cj.*,
        p.name AS requested_proxy_name,
        au.username AS created_by_username
      FROM check_jobs cj
      LEFT JOIN proxies p ON p.id = cj.requested_proxy_id
      LEFT JOIN admin_users au ON au.id = cj.created_by_admin_id
      WHERE cj.id = ?
      LIMIT 1
    `)
    .get(id);
}

function listBatchJobItems(jobId, limit = 50) {
  return getDatabase()
    .prepare(`
      SELECT
        cji.*,
        p.name AS proxy_name
      FROM check_job_items cji
      LEFT JOIN proxies p ON p.id = cji.proxy_id
      WHERE cji.job_id = ?
      ORDER BY cji.id ASC
      LIMIT ?
    `)
    .all(jobId, limit);
}

function listBatchJobItemsDetailed(jobId) {
  return getDatabase()
    .prepare(`
      SELECT
        cji.*,
        p.name AS proxy_name,
        cr.limit_usd,
        cr.usage_usd,
        cr.balance_usd,
        cr.has_payment_method,
        cr.raw_response_json
      FROM check_job_items cji
      LEFT JOIN proxies p ON p.id = cji.proxy_id
      LEFT JOIN check_results cr ON cr.job_item_id = cji.id
      WHERE cji.job_id = ?
      ORDER BY cji.id ASC
    `)
    .all(jobId);
}

function getBatchJobStats(jobId) {
  return getDatabase()
    .prepare(`
      SELECT
        COUNT(*) AS total_items,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_items,
        COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running_items,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success_items,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_items
      FROM check_job_items
      WHERE job_id = ?
    `)
    .get(jobId);
}

function getBatchSummary() {
  return getDatabase()
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM check_jobs
    `)
    .get();
}

function listRunnableJobs() {
  return getDatabase()
    .prepare(`
      SELECT
        cj.*,
        COUNT(CASE WHEN cji.status = 'pending' THEN 1 END) AS pending_items
      FROM check_jobs cj
      LEFT JOIN check_job_items cji ON cji.job_id = cj.id
      WHERE cj.status IN ('queued', 'running')
      GROUP BY cj.id
      HAVING pending_items > 0
      ORDER BY cj.id ASC
    `)
    .all();
}

function getNextPendingItem(jobId) {
  return getDatabase()
    .prepare(`
      SELECT *
      FROM check_job_items
      WHERE job_id = ? AND status = 'pending'
      ORDER BY id ASC
      LIMIT 1
    `)
    .get(jobId);
}

function reserveJobItem(jobId, itemId) {
  const db = getDatabase();
  const transaction = db.transaction(() => {
    db.prepare(
      `
        UPDATE check_jobs
        SET
          status = 'running',
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
        WHERE id = ? AND status = 'queued'
      `
    ).run(jobId);

    const result = db.prepare(
      `
        UPDATE check_job_items
        SET status = 'running'
        WHERE id = ? AND status = 'pending'
      `
    ).run(itemId);

    return result.changes > 0;
  });

  return transaction();
}

function decryptBatchItemApiKey(item) {
  return decryptText(item.api_key_encrypted);
}

function markBatchItemSuccess({ itemId, jobId, proxyId, responseTimeMs, result, attemptsUsed }) {
  const db = getDatabase();
  const payload = result.data || result;

  const transaction = db.transaction(() => {
    db.prepare(
      `
        UPDATE check_job_items
        SET
          status = 'success',
          attempt_count = attempt_count + ?,
          proxy_id = ?,
          response_time_ms = ?,
          error_code = NULL,
          error_message = NULL,
          api_key_encrypted = NULL,
          finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(attemptsUsed, proxyId, responseTimeMs, itemId);

    db.prepare(
      `
        INSERT INTO check_results (
          job_item_id,
          limit_usd,
          usage_usd,
          balance_usd,
          has_payment_method,
          raw_response_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_item_id) DO UPDATE SET
          limit_usd = excluded.limit_usd,
          usage_usd = excluded.usage_usd,
          balance_usd = excluded.balance_usd,
          has_payment_method = excluded.has_payment_method,
          raw_response_json = excluded.raw_response_json
      `
    ).run(
      itemId,
      payload.limit_usd,
      payload.usage_usd,
      payload.balance_usd,
      payload.has_payment_method ? 1 : 0,
      JSON.stringify(result.rawResponse || null)
    );
  });

  transaction();
  syncBatchJobState(jobId);
}

function markBatchItemFailure({ itemId, jobId, proxyId, responseTimeMs, errorCode, errorMessage, attemptsUsed }) {
  getDatabase()
    .prepare(
      `
        UPDATE check_job_items
        SET
          status = 'failed',
          attempt_count = attempt_count + ?,
          proxy_id = ?,
          response_time_ms = ?,
          error_code = ?,
          error_message = ?,
          finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    )
    .run(attemptsUsed, proxyId || null, responseTimeMs || null, errorCode || null, errorMessage || null, itemId);

  syncBatchJobState(jobId);
}

function syncBatchJobState(jobId) {
  const db = getDatabase();
  const currentJob = db.prepare('SELECT status FROM check_jobs WHERE id = ? LIMIT 1').get(jobId);
  const summary = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total_items,
          SUM(CASE WHEN status IN ('success', 'failed', 'skipped') THEN 1 ELSE 0 END) AS processed_items,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_items,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_items,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_items,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_items
        FROM check_job_items
        WHERE job_id = ?
      `
    )
    .get(jobId);

  const currentStatus = currentJob ? currentJob.status : 'running';
  let status = currentStatus;

  if (Number(summary.pending_items || 0) === 0 && Number(summary.running_items || 0) === 0) {
    if (currentStatus === 'cancelled') {
      status = 'cancelled';
    } else {
      status = Number(summary.success_items || 0) > 0 ? 'completed' : 'failed';
    }

    db.prepare(
      `
        UPDATE check_jobs
        SET
          status = ?,
          total_items = ?,
          processed_items = ?,
          success_items = ?,
          failed_items = ?,
          finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(
      status,
      summary.total_items || 0,
      summary.processed_items || 0,
      summary.success_items || 0,
      summary.failed_items || 0,
      jobId
    );
    return;
  }

  if (currentStatus === 'paused') {
    status = 'paused';
  } else if (currentStatus === 'cancelled') {
    status = 'cancelled';
  } else if (Number(summary.running_items || 0) > 0) {
    status = 'running';
  } else if (currentStatus === 'queued' || Number(summary.pending_items || 0) > 0) {
    status = 'queued';
  } else {
    status = 'running';
  }

  db.prepare(
    `
      UPDATE check_jobs
      SET
        status = ?,
        total_items = ?,
        processed_items = ?,
        success_items = ?,
        failed_items = ?,
        finished_at = NULL
      WHERE id = ?
    `
  ).run(
    status,
    summary.total_items || 0,
    summary.processed_items || 0,
    summary.success_items || 0,
    summary.failed_items || 0,
    jobId
  );
}

function pauseBatchJob(jobId) {
  const job = getBatchJobById(jobId);

  if (!job) {
    throw new Error('Batch job not found');
  }

  if (!['queued', 'running'].includes(job.status)) {
    throw new Error('Only queued or running jobs can be paused');
  }

  getDatabase()
    .prepare(
      `
        UPDATE check_jobs
        SET status = 'paused'
        WHERE id = ?
      `
    )
    .run(jobId);
}

function resumeBatchJob(jobId) {
  const job = getBatchJobById(jobId);

  if (!job) {
    throw new Error('Batch job not found');
  }

  if (job.status !== 'paused') {
    throw new Error('Only paused jobs can be resumed');
  }

  const stats = getBatchJobStats(jobId);
  const nextStatus = Number(stats.pending_items || 0) > 0 ? 'queued' : 'completed';

  getDatabase()
    .prepare(
      `
        UPDATE check_jobs
        SET status = ?
        WHERE id = ?
      `
    )
    .run(nextStatus, jobId);
}

function cancelBatchJob(jobId) {
  const job = getBatchJobById(jobId);

  if (!job) {
    throw new Error('Batch job not found');
  }

  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    throw new Error('This job can no longer be cancelled');
  }

  const db = getDatabase();

  db.prepare(
    `
      UPDATE check_job_items
      SET
        status = 'skipped',
        error_code = COALESCE(error_code, 'cancelled'),
        error_message = COALESCE(error_message, 'Cancelled by admin'),
        api_key_encrypted = NULL,
        finished_at = CURRENT_TIMESTAMP
      WHERE job_id = ? AND status = 'pending'
    `
  ).run(jobId);

  db.prepare(
    `
      UPDATE check_jobs
      SET status = 'cancelled'
      WHERE id = ?
    `
  ).run(jobId);

  syncBatchJobState(jobId);
}

function retryFailedBatchItems(jobId) {
  const job = getBatchJobById(jobId);

  if (!job) {
    throw new Error('Batch job not found');
  }

  if (job.status === 'running') {
    throw new Error('Pause the job before retrying failed items');
  }

  const db = getDatabase();
  const retryableItems = db
    .prepare(
      `
        SELECT id
        FROM check_job_items
        WHERE job_id = ? AND status = 'failed' AND api_key_encrypted IS NOT NULL
      `
    )
    .all(jobId);

  if (!retryableItems.length) {
    throw new Error('No retryable failed items found');
  }

  const ids = retryableItems.map((item) => item.id);
  const placeholders = ids.map(() => '?').join(', ');

  db.prepare(
    `
      UPDATE check_job_items
      SET
        status = 'pending',
        proxy_id = NULL,
        response_time_ms = NULL,
        error_code = NULL,
        error_message = NULL,
        finished_at = NULL
      WHERE id IN (${placeholders})
    `
  ).run(...ids);

  db.prepare(
    `
      UPDATE check_jobs
      SET
        status = 'queued',
        finished_at = NULL
      WHERE id = ?
    `
  ).run(jobId);

  syncBatchJobState(jobId);

  return {
    retriedCount: ids.length,
  };
}

module.exports = {
  cancelBatchJob,
  createBatchJob,
  decryptBatchItemApiKey,
  getBatchJobById,
  getBatchJobStats,
  getBatchSummary,
  getNextPendingItem,
  listBatchJobItems,
  listBatchJobItemsDetailed,
  listBatchJobs,
  listRunnableJobs,
  pauseBatchJob,
  markBatchItemFailure,
  markBatchItemSuccess,
  reserveJobItem,
  resumeBatchJob,
  retryFailedBatchItems,
  syncBatchJobState,
};
