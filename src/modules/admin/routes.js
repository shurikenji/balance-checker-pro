const express = require('express');
const csurf = require('csurf');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

const { verifyAdminCredentials } = require('../auth/service');
const { createAuditLog } = require('../audit/service');
const { enforceAdminIpAllowlist, requireAdmin } = require('./middleware');
const { listCheckLogs } = require('../logs/service');
const { listSettings, updateSettings } = require('../settings/service');
const {
  cancelBatchJob,
  createBatchJob,
  getBatchSummary,
  getBatchJobById,
  getBatchJobStats,
  listBatchJobItems,
  listBatchJobItemsDetailed,
  listBatchJobs,
  pauseBatchJob,
  resumeBatchJob,
  retryFailedBatchItems,
} = require('../batch/service');
const {
  createProxy,
  deleteProxy,
  getProxyById,
  getProxySummary,
  listProxies,
  testProxyConnectivity,
  updateProxy,
  updateProxyStatus,
} = require('../proxies/service');

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please wait and try again.',
});
const csrfProtection = csurf();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024,
  },
});

router.use(enforceAdminIpAllowlist);
router.use(csrfProtection);
router.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

router.get('/login', (req, res) => {
  if (req.session.adminUser) {
    return res.redirect('/admin');
  }

  return res.render('admin/login', {
    title: 'Admin Login',
    error: req.query.error || '',
  });
});

router.post('/login', loginLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.redirect('/admin/login?error=Missing%20username%20or%20password');
  }

  const admin = await verifyAdminCredentials(username, password);

  if (!admin) {
    return res.redirect('/admin/login?error=Invalid%20credentials');
  }

  req.session.adminUser = admin;
  createAuditLog({
    adminUserId: admin.id,
    action: 'admin.login',
    entityType: 'admin_user',
    entityId: admin.id,
  });

  return res.redirect('/admin');
});

router.post('/logout', requireAdmin, (req, res) => {
  createAuditLog({
    adminUserId: req.session.adminUser.id,
    action: 'admin.logout',
    entityType: 'admin_user',
    entityId: req.session.adminUser.id,
  });

  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.get('/', requireAdmin, (req, res) => {
  const proxySummary = getProxySummary();
  const batchSummary = getBatchSummary();

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    adminUser: req.session.adminUser,
    proxySummary,
    batchSummary,
  });
});

router.get('/proxies', requireAdmin, (req, res) => {
  res.render('admin/proxies', {
    title: 'Proxy Management',
    adminUser: req.session.adminUser,
    proxies: listProxies(),
    error: req.query.error || '',
    success: req.query.success || '',
  });
});

router.get('/proxies/:id/edit', requireAdmin, (req, res) => {
  const proxyId = Number(req.params.id);
  const proxy = getProxyById(proxyId);

  if (!proxy) {
    return res.redirect('/admin/proxies?error=Proxy%20not%20found');
  }

  return res.render('admin/proxy-edit', {
    title: 'Edit Proxy',
    adminUser: req.session.adminUser,
    proxy,
    error: req.query.error || '',
  });
});

router.post('/proxies', requireAdmin, (req, res) => {
  try {
    const proxy = createProxy({
      name: req.body.name,
      baseUrl: req.body.base_url,
      rateMultiplier: req.body.rate_multiplier,
      timeoutMs: req.body.timeout_ms,
      weight: req.body.weight,
      priority: req.body.priority,
      maxConcurrency: req.body.max_concurrency,
      notes: req.body.notes,
    });

    createAuditLog({
      adminUserId: req.session.adminUser.id,
      action: 'proxy.create',
      entityType: 'proxy',
      entityId: proxy.id,
      meta: {
        name: proxy.name,
        baseUrl: proxy.base_url,
      },
    });

    return res.redirect('/admin/proxies?success=Proxy%20created');
  } catch (error) {
    return res.redirect(`/admin/proxies?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/proxies/:id/toggle', requireAdmin, (req, res) => {
  const proxyId = Number(req.params.id);
  const nextStatus = req.body.next_status === 'disabled' ? 'disabled' : 'active';

  updateProxyStatus(proxyId, nextStatus);
  createAuditLog({
    adminUserId: req.session.adminUser.id,
    action: 'proxy.status.update',
    entityType: 'proxy',
    entityId: proxyId,
    meta: {
      status: nextStatus,
    },
  });

  return res.redirect(`/admin/proxies?success=${encodeURIComponent(`Proxy ${nextStatus}`)}`);
});

router.post('/proxies/:id/edit', requireAdmin, (req, res) => {
  const proxyId = Number(req.params.id);

  try {
    const proxy = updateProxy(proxyId, {
      name: req.body.name,
      baseUrl: req.body.base_url,
      rateMultiplier: req.body.rate_multiplier,
      timeoutMs: req.body.timeout_ms,
      weight: req.body.weight,
      priority: req.body.priority,
      maxConcurrency: req.body.max_concurrency,
      notes: req.body.notes,
    });

    createAuditLog({
      adminUserId: req.session.adminUser.id,
      action: 'proxy.update',
      entityType: 'proxy',
      entityId: proxy.id,
      meta: {
        name: proxy.name,
        baseUrl: proxy.base_url,
        rateMultiplier: proxy.rate_multiplier,
      },
    });

    return res.redirect('/admin/proxies?success=Proxy%20updated');
  } catch (error) {
    return res.redirect(`/admin/proxies/${proxyId}/edit?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/proxies/:id/delete', requireAdmin, (req, res) => {
  const proxyId = Number(req.params.id);

  try {
    deleteProxy(proxyId);
    createAuditLog({
      adminUserId: req.session.adminUser.id,
      action: 'proxy.delete',
      entityType: 'proxy',
      entityId: proxyId,
    });

    return res.redirect('/admin/proxies?success=Proxy%20deleted');
  } catch (error) {
    return res.redirect(`/admin/proxies?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/proxies/:id/test', requireAdmin, async (req, res) => {
  const proxyId = Number(req.params.id);
  const result = await testProxyConnectivity(proxyId);

  createAuditLog({
    adminUserId: req.session.adminUser.id,
    action: 'proxy.test',
    entityType: 'proxy',
    entityId: proxyId,
    meta: result,
  });

  const key = result.ok ? 'success' : 'error';
  return res.redirect(`/admin/proxies?${key}=${encodeURIComponent(result.message)}`);
});

router.get('/batches', requireAdmin, (req, res) => {
  const jobs = listBatchJobs().map((job) => ({
    ...job,
    itemsPreview: listBatchJobItems(job.id, 5),
  }));

  res.render('admin/batches', {
    title: 'Batch Jobs',
    adminUser: req.session.adminUser,
    proxies: listProxies().filter((proxy) => proxy.status === 'active'),
    jobs,
    error: req.query.error || '',
    success: req.query.success || '',
  });
});

router.get('/logs', requireAdmin, (req, res) => {
  const filters = {
    type: String(req.query.type || '').trim(),
    status: String(req.query.status || '').trim(),
    proxyId: String(req.query.proxy_id || '').trim(),
    limit: String(req.query.limit || '100').trim(),
  };

  res.render('admin/logs', {
    title: 'Check Logs',
    adminUser: req.session.adminUser,
    logs: listCheckLogs(filters),
    proxies: listProxies(),
    filters,
  });
});

router.get('/settings', requireAdmin, (req, res) => {
  res.render('admin/settings', {
    title: 'System Settings',
    adminUser: req.session.adminUser,
    settings: listSettings(),
    error: req.query.error || '',
    success: req.query.success || '',
  });
});

router.post('/settings', requireAdmin, (req, res) => {
  try {
    updateSettings(req.body);
    createAuditLog({
      adminUserId: req.session.adminUser.id,
      action: 'settings.update',
      entityType: 'system_settings',
      entityId: 'global',
      meta: {
        updatedKeys: Object.keys(req.body),
      },
    });

    return res.redirect('/admin/settings?success=Settings%20updated');
  } catch (error) {
    return res.redirect(`/admin/settings?error=${encodeURIComponent(error.message)}`);
  }
});

router.get('/batches/:id', requireAdmin, (req, res) => {
  const jobId = Number(req.params.id);
  const job = getBatchJobById(jobId);

  if (!job) {
    return res.redirect('/admin/batches?error=Batch%20job%20not%20found');
  }

  res.render('admin/batch-detail', {
    title: `Batch #${job.id}`,
    adminUser: req.session.adminUser,
    job,
    stats: getBatchJobStats(jobId),
    items: listBatchJobItemsDetailed(jobId),
    error: req.query.error || '',
    success: req.query.success || '',
  });
});

router.post('/batches/:id/pause', requireAdmin, (req, res) => {
  const jobId = Number(req.params.id);

  try {
    pauseBatchJob(jobId);
    createAuditLog({
      adminUserId: req.session.adminUser.id,
      action: 'batch.pause',
      entityType: 'check_job',
      entityId: jobId,
    });

    return res.redirect(`/admin/batches/${jobId}`);
  } catch (error) {
    return res.redirect(`/admin/batches/${jobId}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/batches/:id/resume', requireAdmin, (req, res) => {
  const jobId = Number(req.params.id);

  try {
    resumeBatchJob(jobId);
    createAuditLog({
      adminUserId: req.session.adminUser.id,
      action: 'batch.resume',
      entityType: 'check_job',
      entityId: jobId,
    });

    return res.redirect(`/admin/batches/${jobId}`);
  } catch (error) {
    return res.redirect(`/admin/batches/${jobId}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/batches/:id/cancel', requireAdmin, (req, res) => {
  const jobId = Number(req.params.id);

  try {
    cancelBatchJob(jobId);
    createAuditLog({
      adminUserId: req.session.adminUser.id,
      action: 'batch.cancel',
      entityType: 'check_job',
      entityId: jobId,
    });

    return res.redirect(`/admin/batches/${jobId}`);
  } catch (error) {
    return res.redirect(`/admin/batches/${jobId}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/batches/:id/retry-failed', requireAdmin, (req, res) => {
  const jobId = Number(req.params.id);

  try {
    const result = retryFailedBatchItems(jobId);
    createAuditLog({
      adminUserId: req.session.adminUser.id,
      action: 'batch.retry_failed',
      entityType: 'check_job',
      entityId: jobId,
      meta: result,
    });

    return res.redirect(`/admin/batches/${jobId}?success=${encodeURIComponent(`Queued ${result.retriedCount} failed items for retry`)}`);
  } catch (error) {
    return res.redirect(`/admin/batches/${jobId}?error=${encodeURIComponent(error.message)}`);
  }
});

router.get('/batches/:id/export.csv', requireAdmin, (req, res) => {
  const jobId = Number(req.params.id);
  const job = getBatchJobById(jobId);

  if (!job) {
    return res.redirect('/admin/batches?error=Batch%20job%20not%20found');
  }

  const items = listBatchJobItemsDetailed(jobId);
  const csv = toCsv([
    [
      'line_number',
      'api_key_mask',
      'status',
      'proxy_name',
      'attempt_count',
      'response_time_ms',
      'balance_usd',
      'usage_usd',
      'limit_usd',
      'has_payment_method',
      'error_code',
      'error_message',
    ],
    ...items.map((item) => [
      item.line_number,
      item.api_key_mask,
      item.status,
      item.proxy_name || job.requested_proxy_name || '',
      item.attempt_count,
      item.response_time_ms || '',
      item.balance_usd || '',
      item.usage_usd || '',
      item.limit_usd || '',
      item.has_payment_method === null || item.has_payment_method === undefined ? '' : item.has_payment_method ? 'yes' : 'no',
      item.error_code || '',
      item.error_message || '',
    ]),
  ]);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=\"batch-${job.id}.csv\"`);
  return res.send(csv);
});

router.post('/batches', requireAdmin, upload.single('batch_file'), (req, res) => {
  try {
    const manualKeys = String(req.body.batch_keys || '').trim();
    const hasManualKeys = manualKeys.length > 0;
    const hasFile = Boolean(req.file);

    if (!hasManualKeys && !hasFile) {
      return res.redirect('/admin/batches?error=Provide%20keys%20in%20the%20textarea%20or%20upload%20a%20file');
    }

    const fileName = hasManualKeys ? 'manual-input.txt' : req.file.originalname;
    const fileContent = hasManualKeys ? manualKeys : req.file.buffer.toString('utf8');

    const result = createBatchJob({
      fileName,
      fileContent,
      requestedProxyId: req.body.proxy_id ? Number(req.body.proxy_id) : null,
      adminUserId: req.session.adminUser.id,
    });

    createAuditLog({
      adminUserId: req.session.adminUser.id,
      action: 'batch.create',
      entityType: 'check_job',
      entityId: result.job.id,
      meta: {
        acceptedCount: result.acceptedCount,
        rejectedCount: result.rejectedCount,
        requestedProxyId: Number(req.body.proxy_id),
        inputMode: hasManualKeys ? 'textarea' : 'file',
      },
    });

    return res.redirect(
      `/admin/batches?success=${encodeURIComponent(
        `Batch created with ${result.acceptedCount} valid keys and ${result.rejectedCount} rejected lines`
      )}`
    );
  } catch (error) {
    return res.redirect(`/admin/batches?error=${encodeURIComponent(error.message)}`);
  }
});

module.exports = router;

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? '');
          if (text.includes('"') || text.includes(',') || text.includes('\n')) {
            return `"${text.replace(/"/g, '""')}"`;
          }
          return text;
        })
        .join(',')
    )
    .join('\n');
}
